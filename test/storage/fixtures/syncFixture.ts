import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gitProcess, gitText } from '../../../src/storage/gitProcess';
import { requireRepository } from '../../../src/storage/gitRepository';
import {
  type PublicationEdit,
  type PublicationPlan,
  readIndex,
  readPublicationFile,
} from '../../../src/storage/gitSyncJournal';

/** A candidate deliberately built with plumbing: no live ref/index/file effects. */
export async function syncFixture(
  dir: string,
  path: string,
  configAfter = '{"version":1,"plugins":{"future":{"enabled":false,"retained":true}}}\n',
) {
  await gitText(dir, ['init', '-b', 'main']);
  await gitText(dir, ['config', 'user.name', 'Journal test']);
  await gitText(dir, ['config', 'user.email', 'journal@example.com']);
  await writeFile(join(path, '.gitignore'), 'local.json\n.lock\n.lock.break\n.txn/\n');
  await writeFile(join(dir, 'code.txt'), 'old code\n');
  await gitText(dir, ['add', '.']);
  await gitText(dir, ['commit', '-m', 'base']);
  const repo = await requireRepository({ path, kind: 'local' });
  const old = await gitText(dir, ['rev-parse', 'HEAD']);
  await writeFile(join(dir, 'staged.txt'), 'staged blob\n');
  await gitText(dir, ['add', 'staged.txt']);
  await writeFile(join(dir, 'staged.txt'), 'unstaged bytes over staged blob\n');
  await writeFile(join(dir, 'untracked.txt'), 'untracked bytes\n');
  const indexBefore = await readIndex(repo);
  const file = (text: Uint8Array | string, mode: '100644' | '100755' = '100644') => ({
    data: Buffer.from(text).toString('base64'),
    mode,
  });
  const values = [
    {
      path: '.rowbly/rowbly.config.json',
      after: file(configAfter),
    },
    { path: '.rowbly/plugins/unknown/blob.bin', after: file(new Uint8Array([0, 255, 1, 128])) },
    { path: 'code.txt', after: file('new code\n', '100755') },
  ];
  const edits: PublicationEdit[] = await Promise.all(
    values.map(async (v) => ({ ...v, before: await readPublicationFile(repo, v.path) })),
  );
  const temporary = join(repo.gitDir, 'rowbly', 'test-index');
  await mkdir(join(repo.gitDir, 'rowbly'), { recursive: true });
  await gitText(dir, ['read-tree', old], { index: temporary });
  for (const edit of edits) {
    const data = edit.after;
    if (!data) throw new Error('Expected fixture payload');
    const oid = await gitText(dir, ['hash-object', '-w', '--stdin'], { input: Buffer.from(data.data, 'base64') });
    await gitText(dir, ['update-index', '--add', '--cacheinfo', data.mode, oid, edit.path], { index: temporary });
  }
  const tree = await gitText(dir, ['write-tree'], { index: temporary });
  const candidate = await gitText(dir, ['commit-tree', tree, '-p', old, '-m', 'prepared local merge']);
  const stagedOid = await gitText(dir, ['rev-parse', ':staged.txt']);
  // Carry forward the live index, including the unrelated staged blob.
  await writeFile(temporary, Buffer.from(indexBefore ?? '', 'base64'));
  for (const edit of edits) {
    const data = edit.after;
    if (!data) throw new Error('Expected fixture payload');
    const oid = await gitText(dir, ['hash-object', '-w', '--stdin'], { input: Buffer.from(data.data, 'base64') });
    await gitText(dir, ['update-index', '--add', '--cacheinfo', data.mode, oid, edit.path], { index: temporary });
  }
  const indexAfter = (await readFile(temporary)).toString('base64');
  const plan: PublicationPlan = {
    branch: 'refs/heads/main',
    old,
    candidate,
    indexBefore,
    indexAfter,
    edits,
    roots: [path],
  };
  return { repo, plan, stagedOid, git: (...args: string[]) => gitText(dir, args), process: gitProcess };
}
