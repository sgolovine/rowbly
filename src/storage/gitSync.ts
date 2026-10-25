// Sync (ADR-0035): commit pending Rowbly data, fetch, rebase onto the upstream in a temporary
// worktree, land the result like `git checkout`, and push without force. No step here holds the
// Data Root lock except the snapshot read that `snapshot` wraps (ADR-0030).
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { ConflictError, ValidationError } from '../core';
import type { DataRoot } from '../schemas';
import { readTextIfExists } from './files';
import { commitGitPaths, gitInfo, pendingPath, runGit } from './git';
import { io } from './io';
import { writeTextFile } from './system';

/** Fetch, rebase, worktree and push commands may talk to a remote or check out a tree. */
const LONG = 60_000;

export interface GitSyncResult {
  /** Whether Sync made a commit of pending Rowbly data. */
  committed: boolean;
  /** Commits taken from the upstream. */
  pulled: number;
  /** Commits pushed to the upstream. */
  pushed: number;
  /** The upstream, such as `origin/main`. */
  upstream: string;
}

/** The line of Git's stderr that names the cause (`fatal: …`, `! [rejected] …`), else the error's message. */
function gitReason(err: unknown): string {
  const failure = err as { stderr?: string; killed?: boolean; message?: string };
  if (failure.killed) return 'Git did not finish in time';
  const lines = (failure.stderr ?? '')
    .split('\n')
    .map((part) => part.trim())
    .filter((part) => part && !part.startsWith('hint:'));
  return lines.find((line) => /^(fatal|error):|^!/.test(line)) ?? lines[0] ?? failure.message ?? String(err);
}

/** Changed, added and deleted files under the Data Root, as Data Root paths, without Local State or Rowbly's own dot files. */
async function pendingRowblyPaths(top: string, prefix: string): Promise<string[]> {
  const out = await runGit(top, [
    'status',
    '--porcelain',
    '-z',
    '--untracked-files=all',
    '--',
    `:(literal)${prefix || '.'}`,
  ]);
  const entries = out.split('\0');
  const paths: string[] = [];
  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i] ?? '';
    if (entry.length < 4) continue;
    const xy = entry.slice(0, 2);
    const names = [entry.slice(3)];
    // A rename or copy is followed by its source path.
    if (xy[0] === 'R' || xy[0] === 'C') {
      i += 1;
      names.push(entries[i] ?? '');
    }
    for (const name of names) {
      const inside = prefix ? name.slice(prefix.length + 1) : name;
      if (!inside || inside === 'local.json' || inside.split('/').some((part) => part.startsWith('.'))) continue;
      paths.push(inside);
    }
  }
  return [...new Set(paths)];
}

export async function syncGit(
  root: DataRoot,
  author: { authorName?: string; authorEmail?: string },
  snapshot: <T>(read: () => Promise<T>) => Promise<T>,
): Promise<GitSyncResult> {
  const info = await gitInfo(root);
  const top = info.root;
  const git = (args: string[], timeout?: number) => runGit(top, args, { timeout });
  const value = async (args: string[]) => {
    try {
      return (await git(args)).trim();
    } catch {
      return '';
    }
  };

  // Preflight: nothing below changes anything until these pass.
  const branch = await value(['symbolic-ref', '--quiet', '--short', 'HEAD']);
  if (!branch)
    throw new ValidationError('Sync needs a branch, but HEAD is detached', {
      hint: 'check out a branch, then run Sync again',
    });
  const upstream = await value(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']);
  const remote = await value(['config', '--get', `branch.${branch}.remote`]);
  const mergeRef = await value(['config', '--get', `branch.${branch}.merge`]);
  if (!upstream || !remote || !mergeRef) {
    const remotes = (await value(['remote'])).split('\n').filter(Boolean);
    const name = remotes.includes('origin') ? 'origin' : (remotes[0] ?? '<remote>');
    throw new ValidationError(`Sync needs an upstream, and branch ${branch} has none`, {
      hint: `run \`git push -u ${name} ${branch}\`, or \`git branch --set-upstream-to ${name}/<branch>\``,
    });
  }
  const gitDir = await value(['rev-parse', '--absolute-git-dir']);
  for (const marker of ['rebase-merge', 'rebase-apply', 'MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD']) {
    if (
      await io.lstat(join(gitDir, marker)).then(
        () => true,
        () => false,
      )
    )
      throw new ValidationError('Sync cannot run while a rebase, merge, cherry-pick or revert is in progress', {
        hint: 'finish or abort it in Git, then run Sync again',
      });
  }
  const name = author.authorName || info.authorName;
  const email = author.authorEmail || info.authorEmail;
  if (!name || !email)
    throw new ValidationError('Sync needs a Git author name and email', {
      hint: 'set `git config user.name` and `user.email`, or the author in the Git settings',
    });

  await finishLanding(root, branch, git);

  // 1. Commit pending Rowbly data; with nothing pending, no commit is made.
  const data = await io.realpath(root.path);
  const prefix = relative(top, data).split('\\').join('/');
  const before = await value(['rev-parse', '--verify', '--quiet', 'HEAD']);
  const pending = await pendingRowblyPaths(top, prefix);
  if (pending.length) await commitGitPaths(root, pending, author, snapshot);
  const head = await value(['rev-parse', '--verify', '--quiet', 'HEAD']);
  const committed = head !== before;
  if (!head)
    throw new ValidationError('Sync needs at least one commit on the branch', {
      hint: 'make a first commit, then run Sync again',
    });

  // 2. Fetch. A failure keeps the local commit.
  try {
    await git(['fetch', '--quiet', remote], LONG);
  } catch (err) {
    throw new ValidationError(`Sync could not fetch from ${remote}: ${gitReason(err)}`, {
      hint: 'check the network and your Git credentials, then run Sync again; your local commits are kept',
    });
  }
  const theirs = await value(['rev-parse', '--verify', '--quiet', '@{u}']);
  if (!theirs)
    throw new ValidationError(`Sync found no upstream branch ${upstream} after fetching`, {
      hint: `check that ${upstream} exists on ${remote}, or run \`git push -u ${remote} ${branch}\``,
    });
  const pulled = Number(await value(['rev-list', '--count', `${head}..${theirs}`]));

  // 3. Rebase onto the upstream without touching the live tree, then land the result.
  let tip = head;
  if (pulled > 0) {
    tip = (await git(['merge-base', '--is-ancestor', head, theirs]).then(
      () => true,
      () => false,
    ))
      ? theirs
      : await rebaseAside(top, head, theirs, upstream, { name, email, hooks: await hooksPath(root) });
    // Land like `git checkout`: a two-tree merge keeps unrelated staged and unstaged changes and
    // refuses to overwrite local changes (`reset --keep` would unstage them), then the branch moves
    // only if it is still where Sync started (compare and swap). The marker lets the next Sync finish
    // a landing that a crash cut between the two, so HEAD never stays behind a tree that is ahead.
    const marker = await landingMarker(root);
    await writeTextFile(marker, JSON.stringify({ branch, old: head, new: tip }));
    try {
      await git(['read-tree', '-m', '-u', head, tip], LONG);
    } catch (err) {
      await io.rm(marker);
      throw new ConflictError(`Sync could not update your working tree: ${gitReason(err)}`, {
        hint: 'commit or stash your own changes to those files, then run Sync again; nothing was pushed and the branch is unchanged',
      });
    }
    try {
      await git(['update-ref', '-m', 'rowbly: Sync', `refs/heads/${branch}`, tip, head]);
    } catch {
      const restored = await git(['read-tree', '-m', '-u', tip, head], LONG).then(
        () => true,
        () => false,
      );
      if (restored) await io.rm(marker);
      throw new ConflictError('The branch changed during Sync', {
        hint: restored
          ? 'run Sync again; nothing was pushed'
          : `check \`git status\`: files from ${upstream} may be staged; nothing was pushed`,
      });
    }
    await io.rm(marker);
  }

  // 4. Push, never forced. A rejection keeps every local commit.
  const pushed = Number(await value(['rev-list', '--count', `${theirs}..${tip}`]));
  if (pushed > 0) {
    try {
      await git(
        ['-c', `core.hooksPath=${await hooksPath(root)}`, 'push', '--quiet', remote, `${tip}:${mergeRef}`],
        LONG,
      );
    } catch (err) {
      const reason = gitReason(err);
      if (/\((fetch first|non-fast-forward)\)/.test(String((err as { stderr?: string }).stderr)))
        throw new ConflictError(`The upstream ${upstream} moved during Sync`, {
          hint: 'run Sync again; your local commits are kept',
        });
      throw new ValidationError(`Sync could not push to ${remote}: ${reason}`, {
        hint: 'check the network and your Git credentials, then run Sync again; your local commits are kept',
      });
    }
  }
  return { committed, pulled, pushed, upstream };
}

/** `<git-dir>/rowbly/sync-landing.json`: written before Sync lands a rebased branch, removed once the branch moved. */
async function landingMarker(root: DataRoot): Promise<string> {
  return join(dirname(await pendingPath(root, 'git')), 'sync-landing.json');
}

/**
 * Finishes a landing that a crash cut after `read-tree` and before `update-ref`: if the branch is
 * still at `old` and the index already holds `new` on every path the landing changes, the branch
 * moves to `new`. Otherwise the marker is stale and is removed. Either way the checkout ends in the
 * complete old or new state, so the next push can never carry a reversal of the upstream's changes.
 */
async function finishLanding(root: DataRoot, branch: string, git: (args: string[]) => Promise<string>) {
  const marker = await landingMarker(root);
  const text = await readTextIfExists(marker);
  if (text === null) return;
  let landing: { branch?: unknown; old?: unknown; new?: unknown } = {};
  try {
    landing = JSON.parse(text);
  } catch {
    /* A torn marker is stale. */
  }
  const { old, new: tip } = landing;
  const ref = `refs/heads/${branch}`;
  if (landing.branch === branch && typeof old === 'string' && typeof tip === 'string') {
    const at = (await git(['rev-parse', '--verify', '--quiet', ref]).catch(() => '')).trim();
    const list = async (args: string[]) => (await git(args)).split('\0').filter(Boolean);
    if (at === old) {
      const landed = await list(['diff-tree', '-r', '--name-only', '-z', old, tip]);
      const differs = new Set(await list(['diff-index', '--cached', '--name-only', '-z', tip, '--']));
      if (landed.length && !landed.some((path) => differs.has(path)))
        await git(['update-ref', '-m', 'rowbly: Sync finished', ref, tip, old]);
    }
  }
  await io.rm(marker);
}

/** The empty hooks folder Rowbly's own Git commands use, so hooks cannot loop back into Rowbly. */
async function hooksPath(root: DataRoot): Promise<string> {
  const hooks = join(dirname(await pendingPath(root, 'git')), 'disabled-hooks');
  await io.mkdir(hooks);
  return hooks;
}

/** Rebases `head` onto `onto` in a temporary detached worktree, and returns the new tip. The live checkout is not touched. */
async function rebaseAside(
  top: string,
  head: string,
  onto: string,
  upstream: string,
  author: { name: string; email: string; hooks: string },
): Promise<string> {
  const tree = await mkdtemp(join(tmpdir(), 'rowbly-sync-'));
  const quiet = ['-c', `core.hooksPath=${author.hooks}`, '-c', 'commit.gpgSign=false'];
  const inTree = (args: string[]) =>
    runGit(tree, [...quiet, '-c', `user.name=${author.name}`, '-c', `user.email=${author.email}`, ...args], {
      timeout: LONG,
      env: { GIT_EDITOR: 'true', GIT_SEQUENCE_EDITOR: 'true' },
    });
  try {
    await runGit(top, [...quiet, 'worktree', 'add', '--quiet', '--detach', tree, head], { timeout: LONG });
    try {
      await inTree(['rebase', '--quiet', '--no-autostash', '--no-update-refs', onto]);
    } catch (err) {
      const files = (await inTree(['diff', '--name-only', '--diff-filter=U']).catch(() => ''))
        .split('\n')
        .filter(Boolean);
      await inTree(['rebase', '--abort']).catch(() => undefined);
      if (!files.length)
        throw new ConflictError(`Sync could not rebase onto ${upstream}: ${gitReason(err)}`, {
          hint: 'nothing was pushed; resolve with `git pull --rebase` and run Sync again',
        });
      throw new ConflictError(`Sync stopped: your commits conflict with ${upstream} in ${files.join(', ')}`, {
        hint: 'nothing was pushed; resolve with `git pull --rebase` and run Sync again',
      });
    }
    return (await inTree(['rev-parse', 'HEAD'])).trim();
  } finally {
    await runGit(top, ['worktree', 'remove', '--force', tree], { timeout: LONG }).catch(() => undefined);
    await runGit(top, ['worktree', 'prune']).catch(() => undefined);
    await io.rm(tree).catch(() => undefined);
  }
}
