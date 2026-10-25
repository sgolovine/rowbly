import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import type { DataRoot } from '../schemas';
import type { GitCommitOptions } from './git';
import { gitProcess, gitText, outsideGitDeadline, withGitDeadline } from './gitProcess';
import { openRebaseBridge } from './gitRebaseBridge';
import { cleanupRebaseContexts, createRebaseContext } from './gitRebaseContext';
import type { GitRebaseHistory, GitReplayData, GitReplayResult } from './gitRebaseTypes';
import { assertGitWorker, canonicalGitRoot, type GitRepository, rootPrefix } from './gitRepository';
import {
  busy,
  commit,
  configuredUpstream,
  type GitDataSource,
  type GitUpstream,
  inRepository,
  inside,
  publishSyncCandidate,
  put,
  type SyncOutcome,
  sourceFiles,
  tree,
} from './gitSync';
import { type GitDataFiles, isGitDataPath, readGitDataFiles } from './gitSyncFiles';
import { readIndex } from './gitSyncJournal';
import { io } from './io';

/** Ordinary code uses Git's explicit original base; core never resolves a non-Rowbly conflict. */
async function mergeTree(
  repo: GitRepository,
  prefix: string,
  base: string,
  current: string,
  source: string,
): Promise<string> {
  const result = await gitProcess(
    repo.top,
    ['merge-tree', '--write-tree', `--merge-base=${base}`, '--name-only', '-z', '--messages', current, source],
    { privateContext: true, allowFailure: true, timeoutMs: 10_000 },
  );
  const parts = result.stdout.toString('utf8').split('\0'),
    oid = parts.shift();
  if (![0, 1].includes(result.code) || !oid || !/^[a-f0-9]{40,64}$/.test(oid))
    throw new Error('Git isolated replay did not produce a supported merge tree');
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
    throw new Error(`Non-Rowbly replay conflicts require manual resolution: ${conflicts.join(', ')}`);
  if (parts.some((text) => /CONFLICT \((?:file\/directory|directory|rename|submodule|distinct)/i.test(text)))
    throw new Error('Unsupported Git replay topology conflict');
  return oid;
}
async function uniqueBase(repo: GitRepository, left: string, right: string): Promise<string> {
  const bases = (await gitText(repo.top, ['merge-base', '--all', left, right], { privateContext: true }))
    .split('\n')
    .filter(Boolean);
  if (bases.length !== 1 || !bases[0]) throw new Error('Ambiguous Git merge bases require manual resolution');
  return bases[0];
}
async function rootTree(
  repo: GitRepository,
  prefix: string,
  index: string,
  base: string,
  files: GitDataFiles,
): Promise<string> {
  if (
    Object.keys(files).length > 4096 ||
    Object.values(files).reduce((bytes, file) => bytes + Buffer.byteLength(file.data, 'base64'), 0) > 64 * 1024 * 1024
  )
    throw new Error('Reconciled candidate exceeds its bounded Data Root size');
  const existing = await sourceFiles(repo, await tree(repo, base), prefix);
  await io.rm(index);
  await gitText(repo.top, ['read-tree', base], { index, privateContext: true });
  for (const path of new Set([...Object.keys(existing), ...Object.keys(files)])) {
    if (!isGitDataPath(path)) throw new Error(`Unsupported Rowbly replay path: ${path}`);
    if (!isDeepStrictEqual(existing[path], files[path]))
      await put(repo, index, inRepository(prefix, path), files[path]);
  }
  return gitText(repo.top, ['write-tree'], { index, privateContext: true });
}

/** Literal private pull first, then pending staging, exact journal installation, then normal push. */
export async function synchronizeGitRebase(
  repo: GitRepository,
  root: DataRoot,
  options: GitCommitOptions,
  capture: <T>(read: () => Promise<T>) => Promise<T>,
  createReplay: (history: GitRebaseHistory) => GitReplayData,
  phase: (name: string) => Promise<void>,
  validate: (files: GitDataFiles) => Promise<void>,
  expectedTarget?: GitUpstream,
): Promise<SyncOutcome> {
  root = await canonicalGitRoot(root);
  assertGitWorker(repo);
  return withGitDeadline(120_000, async () => {
    await cleanupRebaseContexts(repo);
    const prefix = rootPrefix(repo, root),
      started = Date.now();
    const deadline = () => {
      if (Date.now() - started > 120_000) throw new Error('Git synchronization exceeded its run deadline');
    };
    for (let attempt = 0; attempt < 3; attempt++) {
      const token = randomBytes(16).toString('hex');
      const directory = join(repo.gitDir, 'rowbly', `rebase-${token}`);
      const installIndex = join(repo.gitDir, 'rowbly', `candidate-${token}-install`);
      const pin = `refs/rowbly/fetched/${token}`;
      await io.mkdir(directory);
      await io.writeFile(
        join(directory, 'owner.json'),
        JSON.stringify({ version: 1, kind: 'rowbly-rebase', token, gitDir: repo.gitDir }),
      );
      try {
        deadline();
        await busy(repo);
        const upstream = await configuredUpstream(repo);
        if (expectedTarget && !isDeepStrictEqual(expectedTarget, upstream))
          throw new Error('Git branch or upstream changed after synchronization admission');
        const old = await gitText(repo.top, ['rev-parse', 'HEAD']);
        const oldTree = await tree(repo, old),
          indexBefore = await readIndex(repo);
        if (indexBefore === null) throw new Error('Git synchronization requires an existing index');
        const staged = (await gitProcess(repo.top, ['diff', '--cached', '--name-only', '-z'])).stdout
          .toString('utf8')
          .split('\0');
        if (
          staged.some((path) => {
            const rel = inside(prefix, path);
            return rel !== null && isGitDataPath(rel);
          })
        )
          throw new Error('Git synchronization refuses already-staged Rowbly changes');
        const eligible = new Set(
          (await gitProcess(repo.top, ['ls-files', '--cached', '--others', '--exclude-standard', '-z'])).stdout
            .toString('utf8')
            .split('\0'),
        );
        // Raw capture is private data, never a pre-pull snapshot commit or index stage.
        const captured = await capture(() => readGitDataFiles(root));
        for (const path of Object.keys(captured))
          if (!eligible.has(inRepository(prefix, path)))
            throw new Error(`Ignored Rowbly data needs explicit handling before synchronization: ${path}`);
        await validate(captured);
        await io.writeFile(join(directory, 'capture.json'), JSON.stringify(captured));
        const context = await createRebaseContext(repo, join(directory, 'repository'), old, upstream, options);
        const index = join(context.gitDir, 'rowbly-index');
        const read = async (id: string): Promise<GitDataSource> => ({
          id,
          files: await sourceFiles(context, await tree(context, id), prefix),
        });
        let replay: GitReplayData | undefined, remote: string | undefined;
        const history = async (): Promise<GitReplayData> => {
          if (replay) return replay;
          remote = await gitText(context.top, ['rev-parse', '--verify', 'FETCH_HEAD'], { privateContext: true });
          await uniqueBase(context, old, remote);
          const lines = (
            await gitText(
              context.top,
              ['rev-list', '--max-count=513', '--reverse', '--topo-order', '--parents', old, `^${remote}`],
              { privateContext: true },
            )
          )
            .split('\n')
            .filter(Boolean);
          if (lines.length > 512) throw new Error('Unpublished Git replay history exceeds its finite bound');
          const nodes: { id: string; parents: string[]; base?: string }[] = [];
          for (const line of lines) {
            const [id, ...parents] = line.split(' ');
            if (!id || !parents.length || parents.length > 2)
              throw new Error('Unsupported unpublished Git merge topology requires manual resolution');
            const node = { id, parents, base: undefined as string | undefined };
            if (parents.length === 2) {
              const [left, right] = parents;
              if (!left || !right) throw new Error('Missing original merge parents');
              node.base = await uniqueBase(context, left, right);
              const normal = await tree(context, await mergeTree(context, prefix, node.base, left, right));
              const committed = await tree(context, id);
              for (const path of new Set([...Object.keys(normal), ...Object.keys(committed)])) {
                const rel = inside(prefix, path);
                if ((rel === null || !isGitDataPath(rel)) && !isDeepStrictEqual(normal[path], committed[path]))
                  throw new Error(`Non-Rowbly merge resolution requires manual handling: ${path}`);
              }
            }
            nodes.push(node);
          }
          replay = createReplay({
            old: await read(old),
            upstream: await read(remote),
            nodes,
            read,
            contains: async (ancestor, descendant) =>
              (
                await gitProcess(context.top, ['merge-base', '--is-ancestor', ancestor, descendant], {
                  privateContext: true,
                  allowFailure: true,
                })
              ).code === 0,
          });
          return replay;
        };
        const bridge = await openRebaseBridge(directory, async (step) => {
          await phase('rebasing');
          if (
            (await gitText(context.top, ['rev-parse', 'HEAD'], { privateContext: true })) !== step.current ||
            (await gitText(context.top, ['rev-parse', `${step.commit}^`], { privateContext: true })) !== step.base
          )
            throw new Error('Git replay inputs changed during private preparation');
          const result = await (await history()).replay(step, await read(step.current));
          await validate(result.files);
          return rootTree(
            context,
            prefix,
            index,
            await mergeTree(context, prefix, step.base, step.current, step.commit),
            result.files,
          );
        });
        let final: GitReplayResult, candidate: string;
        try {
          await phase('pulling');
          await gitText(
            context.top,
            [
              'pull',
              '--rebase',
              '--no-tags',
              '--no-recurse-submodules',
              '--strategy=rowbly-sync',
              'origin',
              upstream.mergeRef,
            ],
            { privateContext: true, rebase: bridge.environment, timeoutMs: 30_000 },
          );
          candidate = await gitText(context.top, ['rev-parse', 'HEAD'], { privateContext: true });
          await phase('preparing');
          final = await (await history()).finish(await read(candidate), { id: `pending:${token}`, files: captured });
          await validate(final.files);
          const finalTree = await rootTree(context, prefix, index, candidate, final.files);
          if (
            finalTree !== (await gitText(context.top, ['rev-parse', `${candidate}^{tree}`], { privateContext: true }))
          )
            candidate = await commit(
              context,
              finalTree,
              [candidate],
              options,
              'chore: synchronize pending Rowbly changes',
            );
        } finally {
          await bridge.close();
        }
        if (!remote) throw new Error('Private pull did not retain its exact fetched upstream');
        if (
          (
            await gitProcess(context.top, ['merge-base', '--is-ancestor', remote, candidate], {
              privateContext: true,
              allowFailure: true,
            })
          ).code !== 0
        )
          throw new Error('Prepared commit does not descend from the fetched upstream');
        await phase('validating');
        // Import objects before intent; recovery never depends on the temporary checkout or alternates.
        await gitText(
          repo.top,
          [
            'fetch',
            '--no-tags',
            '--no-write-fetch-head',
            '--no-recurse-submodules',
            '--',
            context.top,
            `${candidate}:${pin}`,
          ],
          { timeoutMs: 30_000 },
        );
        try {
          return await publishSyncCandidate(repo, root, installIndex, capture, validate, phase, deadline, {
            old,
            oldTree,
            candidate,
            indexBefore,
            captured,
            upstream,
            remote,
            evidence: final.evidence,
            repairs: final.repairs,
          });
        } catch (error) {
          if (error instanceof Error && error.message === 'Rowbly capture changed; prepare again' && attempt < 2)
            continue;
          throw error;
        }
      } finally {
        await io.rm(installIndex);
        await outsideGitDeadline(() => gitText(repo.top, ['update-ref', '-d', pin])).catch(() => undefined);
        await io.rm(directory);
      }
    }
    throw new Error('Rowbly changes stayed busy; run Sync again after the current save');
  });
}
