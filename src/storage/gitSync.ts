import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import type { DataRoot } from '../schemas';
import type { GitCommitOptions } from './git';
import { gitProcess, gitText, outsideGitDeadline, withGitDeadline } from './gitProcess';
import { assertGitWorker, type GitRepository, rootPrefix } from './gitRepository';
import { type GitDataFiles, isGitDataPath, readGitDataFiles } from './gitSyncFiles';
import {
  type PublicationEdit,
  type PublicationFile,
  type PublicationPlan,
  publishPublication,
  readIndex,
  readPublicationFile,
  withPublication,
} from './gitSyncJournal';
import { entryExists, io } from './io';
import { writeFileAtomic } from './system';

export class GitSyncPushError extends Error {
  constructor(
    message: string,
    readonly local: SyncOutcome,
  ) {
    super(`Local result saved; push failed: ${message}`);
  }
}
export interface GitUpstream {
  branch: string;
  remote: string;
  mergeRef: string;
}
export interface SyncOutcome {
  commit: string;
  upstream: string;
  evidence: string[];
  repairs: number;
  pushed: boolean;
}
export interface GitDataSource {
  id: string;
  files: GitDataFiles;
}
export interface GitReconciled {
  files: GitDataFiles;
  evidence: string[];
  decisions: readonly unknown[];
}
interface TreeEntry {
  oid: string;
  mode: string;
}
type Tree = Record<string, TreeEntry>;
export async function configuredUpstream(repo: GitRepository): Promise<GitUpstream> {
  const branch = await gitText(repo.top, ['symbolic-ref', '--quiet', 'HEAD']);
  if (!branch.startsWith('refs/heads/')) throw new Error('Git synchronization requires a checked-out branch');
  const name = branch.slice(11);
  const remote = await gitText(repo.top, ['config', '--get', `branch.${name}.remote`], { allowFailure: true });
  const mergeRef = await gitText(repo.top, ['config', '--get', `branch.${name}.merge`], { allowFailure: true });
  if (!remote || !mergeRef || mergeRef.includes('\n'))
    throw new Error('The current branch needs one configured Git upstream');
  await gitText(repo.top, ['check-ref-format', mergeRef]);
  return { branch, remote, mergeRef };
}
async function tree(repo: GitRepository, ref: string): Promise<Tree> {
  const text = (await gitProcess(repo.top, ['ls-tree', '-r', '-z', ref])).stdout.toString('utf8');
  const out: Tree = {};
  for (const line of text.split('\0').filter(Boolean)) {
    const match = /^(\d+) (?:blob|commit) ([a-f0-9]+)\t(.+)$/.exec(line);
    if (!match?.[1] || !match[2] || !match[3]) throw new Error('Unsupported Git tree entry');
    out[match[3]] = { mode: match[1], oid: match[2] };
  }
  return out;
}
function inside(prefix: string, path: string): string | null {
  return prefix ? (path.startsWith(`${prefix}/`) ? path.slice(prefix.length + 1) : null) : path;
}
function inRepository(prefix: string, path: string): string {
  return prefix ? `${prefix}/${path}` : path;
}
async function blob(repo: GitRepository, entry: TreeEntry): Promise<PublicationFile> {
  if (!['100644', '100755'].includes(entry.mode))
    throw new Error('Git synchronization refuses changed symbolic links or submodules');
  const bytes = (await gitProcess(repo.top, ['cat-file', 'blob', entry.oid])).stdout;
  return { data: bytes.toString('base64'), mode: entry.mode as PublicationFile['mode'] };
}
async function sourceFiles(repo: GitRepository, entries: Tree, prefix: string): Promise<GitDataFiles> {
  const files: GitDataFiles = {};
  let total = 0;
  for (const [path, entry] of Object.entries(entries)) {
    const rel = inside(prefix, path);
    if (rel === null) continue;
    if (/^(local.json|\.lock(?:\.break)?|\.txn(?:\/|$))/.test(rel))
      throw new Error(`Upstream tracks private Rowbly files: ${path}`);
    if (!isGitDataPath(rel)) continue;
    const file = await blob(repo, entry);
    total += file.data.length;
    if (Object.keys(files).length >= 4096 || total > 90 * 1024 * 1024)
      throw new Error('Git source exceeds its bounded Data Root size');
    files[rel] = file;
  }
  return files;
}
async function put(repo: GitRepository, index: string, path: string, file: PublicationFile | undefined) {
  if (!file) {
    await gitText(repo.top, ['update-index', '--force-remove', '--', path], { index });
    return;
  }
  const oid = await gitText(repo.top, ['hash-object', '-w', '--stdin'], { input: Buffer.from(file.data, 'base64') });
  await gitText(repo.top, ['update-index', '--add', '--cacheinfo', file.mode, oid, path], { index });
}
async function commit(
  repo: GitRepository,
  treeOid: string,
  parents: string[],
  options: GitCommitOptions,
  message: string,
): Promise<string> {
  return gitText(repo.top, [
    ...(options.authorName ? ['-c', `user.name=${options.authorName}`] : []),
    ...(options.authorEmail ? ['-c', `user.email=${options.authorEmail}`] : []),
    'commit-tree',
    treeOid,
    ...parents.flatMap((p) => ['-p', p]),
    '-m',
    message,
  ]);
}
async function busy(repo: GitRepository) {
  for (const path of ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'rebase-apply', 'rebase-merge', 'sequencer'])
    if (await entryExists(join(repo.gitDir, path)))
      throw new Error('Finish the current Git operation before synchronization');
  if ((await gitProcess(repo.top, ['ls-files', '--unmerged', '-z'])).stdout.length)
    throw new Error('Git synchronization refuses an unmerged index');
}
async function mergeOptions(repo: GitRepository): Promise<string[]> {
  const configured = await gitText(repo.top, ['config', '--get-regexp', '^merge\\..*\\.driver$'], {
    allowFailure: true,
  });
  const args = ['-c', 'merge.default=text', '-c', 'merge.renormalize=false', '-c', 'rerere.enabled=false'];
  for (const line of configured.split('\n').filter(Boolean)) {
    const key = line.split(/\s/)[0];
    if (!key || !/^merge\.[A-Za-z0-9_.-]+\.driver$/.test(key))
      throw new Error('Unsupported custom Git merge driver name');
    args.push('-c', `${key}=false`);
  }
  return args;
}

/** Build/fetch/merge off to the side, publish locally only after complete validation, then normal push. */
export function synchronizeGit(...args: Parameters<typeof runSynchronization>): Promise<SyncOutcome> {
  return withGitDeadline(120_000, () => runSynchronization(...args));
}
async function runSynchronization(
  repo: GitRepository,
  root: DataRoot,
  options: GitCommitOptions,
  capture: <T>(read: () => Promise<T>) => Promise<T>,
  reconcile: (base: GitDataSource, left: GitDataSource, right: GitDataSource) => GitReconciled,
  phase: (name: string) => Promise<void>,
  validate: (files: GitDataFiles) => Promise<void>,
): Promise<SyncOutcome> {
  assertGitWorker(repo);
  const started = Date.now(),
    token = randomBytes(16).toString('hex'),
    fetched = `refs/rowbly/fetched/${token}`;
  const index = join(repo.gitDir, 'rowbly', `candidate-${token}`),
    installIndex = `${index}-install`;
  const prefix = rootPrefix(repo, root);
  const deadline = () => {
    if (Date.now() - started > 120_000) throw new Error('Git synchronization exceeded its run deadline');
  };
  try {
    await busy(repo);
    const upstream = await configuredUpstream(repo);
    await phase('fetching');
    await gitText(
      repo.top,
      [
        'fetch',
        '--no-tags',
        '--no-write-fetch-head',
        '--no-recurse-submodules',
        '--',
        upstream.remote,
        `${upstream.mergeRef}:${fetched}`,
      ],
      { timeoutMs: 30_000 },
    );
    const remote = await gitText(repo.top, ['rev-parse', fetched]);
    const driverOptions = await mergeOptions(repo);
    for (let attempt = 0; attempt < 3; attempt++) {
      deadline();
      await busy(repo);
      await phase('preparing');
      const old = await gitText(repo.top, ['rev-parse', 'HEAD']);
      const oldTree = await tree(repo, old),
        remoteTree = await tree(repo, remote);
      const eligible = new Set(
        (await gitProcess(repo.top, ['ls-files', '--cached', '--others', '--exclude-standard', '-z'])).stdout
          .toString('utf8')
          .split('\0'),
      );
      const staged = (await gitProcess(repo.top, ['diff', '--cached', '--name-only', '-z'])).stdout
        .toString('utf8')
        .split('\0');
      if (
        staged.some((p) => {
          const rel = inside(prefix, p);
          return rel !== null && isGitDataPath(rel);
        })
      )
        throw new Error('Git synchronization refuses already-staged Rowbly changes');
      const indexBefore = await readIndex(repo);
      if (indexBefore === null) throw new Error('Git synchronization requires an existing index');
      const captured = await capture(() => readGitDataFiles(root));
      for (const path of Object.keys(captured))
        if (!eligible.has(inRepository(prefix, path)))
          throw new Error(`Ignored Rowbly data needs explicit handling before synchronization: ${path}`);
      const original = await sourceFiles(repo, oldTree, prefix);
      await io.rm(index);
      await gitText(repo.top, ['read-tree', old], { index });
      for (const path of new Set([...Object.keys(original), ...Object.keys(captured)]))
        if (!isDeepStrictEqual(original[path], captured[path]))
          await put(repo, index, inRepository(prefix, path), captured[path]);
      const captureTree = await gitText(repo.top, ['write-tree'], { index });
      const oldTreeOid = await gitText(repo.top, ['rev-parse', `${old}^{tree}`]);
      const local =
        captureTree === oldTreeOid
          ? old
          : await commit(repo, captureTree, [old], options, 'chore: capture Rowbly changes for synchronization');
      const base = await gitText(repo.top, ['merge-base', local, remote]);
      const merged = await gitProcess(
        repo.top,
        [...driverOptions, 'merge-tree', '--write-tree', '--name-only', '-z', '--messages', local, remote],
        { allowFailure: true, timeoutMs: 10_000 },
      );
      if (![0, 1].includes(merged.code))
        throw new Error('Git synchronization requires modern merge-tree --write-tree plumbing');
      const parts = merged.stdout.toString('utf8').split('\0'),
        mergedTree = parts.shift();
      if (!mergedTree || !/^[a-f0-9]{40,64}$/.test(mergedTree))
        throw new Error('Git isolated merge did not produce a tree');
      const conflicts: string[] = [];
      for (const path of parts) {
        if (!path) break;
        conflicts.push(path);
      }
      if (
        conflicts.some((path) => {
          const rel = inside(prefix, path);
          return rel === null || !isGitDataPath(rel);
        })
      )
        throw new Error(`Non-Rowbly conflicts require manual resolution: ${conflicts.join(', ')}`);
      // Structural conflict messages also fail closed, even if a path happens to be recognized.
      if (parts.some((text) => /CONFLICT \((?:file\/directory|directory|rename|submodule|distinct)/i.test(text)))
        throw new Error('Unsupported Git merge topology conflict');
      const rootMerge = reconcile(
        { id: base, files: await sourceFiles(repo, await tree(repo, base), prefix) },
        { id: local, files: captured },
        { id: remote, files: await sourceFiles(repo, remoteTree, prefix) },
      );
      await validate(rootMerge.files);
      deadline();
      await phase('validating');
      await io.rm(index);
      await gitText(repo.top, ['read-tree', mergedTree], { index });
      const mergedEntries = await tree(repo, mergedTree);
      const existingRoot = await sourceFiles(repo, mergedEntries, prefix);
      for (const path of new Set([...Object.keys(existingRoot), ...Object.keys(rootMerge.files)]))
        await put(repo, index, inRepository(prefix, path), rootMerge.files[path]);
      const finalTree = await gitText(repo.top, ['write-tree'], { index });
      const remoteTreeOid = await gitText(repo.top, ['rev-parse', `${remote}^{tree}`]);
      let candidate: string;
      const localAncestor =
        (await gitProcess(repo.top, ['merge-base', '--is-ancestor', local, remote], { allowFailure: true })).code === 0;
      const remoteAncestor =
        (await gitProcess(repo.top, ['merge-base', '--is-ancestor', remote, local], { allowFailure: true })).code === 0;
      if (localAncestor && finalTree === remoteTreeOid) candidate = remote;
      else if (remoteAncestor && finalTree === captureTree) candidate = local;
      else
        candidate = await commit(
          repo,
          finalTree,
          [...new Set([local, remote])],
          options,
          'chore: synchronize Rowbly data',
        );
      const finalEntries = await tree(repo, candidate),
        edits: PublicationEdit[] = [];
      await writeFileAtomic(installIndex, Buffer.from(indexBefore, 'base64'));
      for (const path of new Set([...Object.keys(oldTree), ...Object.keys(finalEntries)])) {
        const beforeEntry = oldTree[path],
          afterEntry = finalEntries[path];
        const rel = inside(prefix, path),
          owned = rel !== null && isGitDataPath(rel);
        if (!owned && isDeepStrictEqual(beforeEntry, afterEntry)) continue;
        const before = owned ? (captured[rel] ?? null) : beforeEntry ? await blob(repo, beforeEntry) : null;
        const after = afterEntry ? await blob(repo, afterEntry) : null;
        // Every unrelated changed path must still match clean HEAD bytes before local intent.
        if (!owned && !isDeepStrictEqual(await readPublicationFile(repo, path), before))
          throw new Error(`Upstream would overwrite unrelated local content: ${path}`);
        const stagedEntry = (
          await gitProcess(repo.top, ['ls-files', '--stage', '-z', '--', `:(literal)${path}`])
        ).stdout.toString('utf8');
        if (
          !owned &&
          (beforeEntry ? !stagedEntry.startsWith(`${beforeEntry.mode} ${beforeEntry.oid} 0\t`) : stagedEntry !== '')
        )
          throw new Error(`Upstream would overwrite unrelated staged content: ${path}`);
        if (!isDeepStrictEqual(before, after)) edits.push({ path, before, after });
        await put(repo, installIndex, path, after ?? undefined);
      }
      if (!isDeepStrictEqual(await configuredUpstream(repo), upstream))
        throw new Error('Git upstream changed while preparing synchronization');
      const plan: PublicationPlan = {
        branch: upstream.branch,
        old,
        candidate,
        indexBefore,
        indexAfter: (await io.readBytes(installIndex)).toString('base64'),
        edits,
        roots: [root.path],
        captures: [{ root: root.path, files: captured }],
      };
      await phase('publishing');
      try {
        await withPublication(repo, (hold) => publishPublication(hold, plan));
      } catch (err) {
        if (err instanceof Error && err.message === 'Rowbly capture changed; prepare again' && attempt < 2) continue;
        throw err;
      }
      // Revalidate installed files, without changing or acknowledging later dirty revisions.
      await validate(await capture(() => readGitDataFiles(root)));
      deadline();
      await phase('pushing');
      if (
        (await gitProcess(repo.top, ['merge-base', '--is-ancestor', remote, candidate], { allowFailure: true }))
          .code !== 0
      )
        throw new Error('Prepared commit does not descend from the fetched upstream');
      const localResult = {
        commit: candidate,
        upstream: `${upstream.remote}/${upstream.mergeRef}`,
        evidence: rootMerge.evidence,
        repairs: rootMerge.decisions.length,
        pushed: false,
      };
      try {
        await gitText(
          repo.top,
          ['push', '--porcelain', '--no-verify', '--', upstream.remote, `${candidate}:${upstream.mergeRef}`],
          { timeoutMs: 30_000 },
        );
      } catch (err) {
        throw new GitSyncPushError(err instanceof Error ? err.message : String(err), localResult);
      }
      return {
        commit: candidate,
        upstream: `${upstream.remote}/${upstream.mergeRef}`,
        evidence: rootMerge.evidence,
        repairs: rootMerge.decisions.length,
        pushed: true,
      };
    }
    throw new Error('Rowbly changes stayed busy; synchronization will retry on its next interval');
  } finally {
    await io.rm(index);
    await io.rm(installIndex);
    await outsideGitDeadline(() => gitText(repo.top, ['update-ref', '-d', fetched])).catch(() => undefined);
  }
}
