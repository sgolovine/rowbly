import { isAbsolute, join, resolve } from 'node:path';
import type { GitCommitOptions } from './git';
import { gitText } from './gitProcess';
import type { GitRepository } from './gitRepository';
import type { GitUpstream } from './gitSync';
import { io } from './io';

/** Deliberately project transport authentication, not executable merge/checkout configuration. */
async function authentication(repo: GitRepository, target: GitRepository, url: string): Promise<void> {
  for (const section of ['credential', 'http']) {
    const text = await gitText(repo.top, ['config', '--null', '--get-urlmatch', section, url], { allowFailure: true });
    for (const entry of text.split('\0').filter(Boolean)) {
      const at = entry.indexOf('\n');
      const key = entry.slice(0, at).toLowerCase(),
        value = entry.slice(at + 1);
      if (
        at < 0 ||
        ![
          'credential.helper',
          'credential.username',
          'credential.usehttppath',
          'http.extraheader',
          'http.proxy',
          'http.sslverify',
          'http.sslcainfo',
          'http.sslcapath',
          'http.sslcert',
          'http.sslkey',
          'http.sslcertpasswordprotected',
        ].includes(key)
      )
        continue;
      await gitText(target.top, ['config', '--add', key, value], { privateContext: true });
    }
  }
}

/** A separate .git owns all refs/config/index/checkout. The live object store is read-only input. */
export async function createRebaseContext(
  repo: GitRepository,
  directory: string,
  old: string,
  upstream: GitUpstream,
  options: GitCommitOptions,
): Promise<GitRepository> {
  const format = await gitText(repo.top, ['rev-parse', '--show-object-format']);
  if (!['sha1', 'sha256'].includes(format) || /[\r\n]/.test(repo.common))
    throw new Error('Unsupported Git object context for isolated rebase');
  await io.mkdir(directory);
  await gitText(
    directory,
    ['init', '--template=', `--object-format=${format}`, `--initial-branch=${upstream.branch.slice(11)}`],
    {
      privateContext: true,
    },
  );
  const gitDir = join(directory, '.git');
  const context: GitRepository = {
    isolated: true,
    top: directory,
    gitDir,
    common: gitDir,
    worker: join(gitDir, 'rowbly/worker'),
    gate: join(gitDir, 'rowbly/publication'),
    journal: join(gitDir, 'rowbly/publication.json'),
    index: join(gitDir, 'index'),
  };
  const config = async (key: string, value: string) =>
    gitText(directory, ['config', key, value], { privateContext: true });
  await io.mkdir(join(gitDir, 'info'));
  await io.mkdir(join(gitDir, 'objects/info'));
  await io.writeFile(join(gitDir, 'objects/info/alternates'), `${join(repo.common, 'objects')}\n`);
  await io.writeFile(
    join(gitDir, 'info/attributes'),
    '* -filter -text -ident -working-tree-encoding -eol merge=text\n',
  );
  for (const [key, value] of [
    ['core.worktree', directory],
    ['core.hooksPath', '/dev/null'],
    ['core.autocrlf', 'false'],
    ['rebase.backend', 'merge'],
    ['rebase.updateRefs', 'false'],
    ['rebase.autoStash', 'false'],
    ['rebase.autoSquash', 'false'],
    ['rerere.enabled', 'false'],
    ['commit.gpgSign', 'false'],
    ['fetch.recurseSubmodules', 'false'],
    ['submodule.recurse', 'false'],
  ] as const)
    await config(key, value);
  for (const [key, override] of [
    ['user.name', options.authorName],
    ['user.email', options.authorEmail],
  ] as const) {
    const value = override ?? (await gitText(repo.top, ['config', '--get', key], { allowFailure: true }));
    if (value) await config(key, value);
  }
  let url = upstream.remote === '.' ? repo.top : await gitText(repo.top, ['remote', 'get-url', '--', upstream.remote]);
  if (!url || /[\r\n]/.test(url)) throw new Error('The Git upstream needs one supported fetch URL');
  if (!/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(url) && !/^[^/]+:/.test(url) && !isAbsolute(url))
    url = resolve(repo.top, url);
  await config('remote.origin.url', url);
  await config('remote.origin.fetch', '+refs/heads/*:refs/remotes/origin/*');
  await config(`branch.${upstream.branch.slice(11)}.remote`, 'origin');
  await config(`branch.${upstream.branch.slice(11)}.merge`, upstream.mergeRef);
  await authentication(repo, context, url);
  await gitText(directory, ['update-ref', upstream.branch, old], { privateContext: true });
  await gitText(directory, ['symbolic-ref', 'HEAD', upstream.branch], { privateContext: true });
  await gitText(directory, ['read-tree', '--reset', '-u', old], { privateContext: true });
  return context;
}

/** The common worker owns abandoned directories only when their exact manifest agrees. */
export async function cleanupRebaseContexts(repo: GitRepository): Promise<void> {
  const parent = join(repo.gitDir, 'rowbly');
  await io.mkdir(parent);
  for (const name of await io.readdir(parent)) {
    if (!/^rebase-[a-f0-9]{32}$/.test(name)) continue;
    const path = join(parent, name),
      manifest = join(path, 'owner.json');
    if (!(await io.lstat(path)).isDirectory() || !(await io.lstat(manifest)).isFile())
      throw new Error('Unsafe abandoned rebase preparation');
    const value = JSON.parse(await io.readFile(manifest));
    if (
      value.version !== 1 ||
      value.kind !== 'rowbly-rebase' ||
      value.token !== name.slice(7) ||
      value.gitDir !== repo.gitDir
    )
      throw new Error('Unrecognized abandoned rebase preparation');
    await io.rm(path);
  }
}
