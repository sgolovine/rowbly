import { randomBytes } from 'node:crypto';
import type { Stats } from 'node:fs';
import { chmod, mkdtemp, symlink } from 'node:fs/promises';
import { createServer, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { errorCode, io } from './io';

export interface GitReplayStep {
  base: string;
  current: string;
  commit: string;
}
export interface GitRebaseEnvironment {
  ROWBLY_REBASE_SOCKET: string;
  ROWBLY_REBASE_TOKEN: string;
  PATH: string;
}

async function readEntry(path: string): Promise<Stats | undefined> {
  try {
    return await io.lstat(path);
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return undefined;
    throw error;
  }
}

function sameEntry(actual: Stats | undefined, owned: Stats | undefined): boolean {
  return actual !== undefined && owned !== undefined && actual.dev === owned.dev && actual.ino === owned.ino;
}

/** One bounded bridge for an owned standalone Git context; not a Plugin capability. */
export async function openRebaseBridge(
  directory: string,
  prepare: (step: GitReplayStep) => Promise<string>,
): Promise<{ environment: GitRebaseEnvironment; close(): Promise<void> }> {
  const token = randomBytes(16).toString('hex');
  const source = import.meta.url.endsWith('.ts');
  const entry = fileURLToPath(new URL(source ? './gitRebaseStrategy.ts' : './gitRebaseStrategy.js', import.meta.url));
  // Quote only host-owned absolute executable paths. Git finds this fixed name in this private PATH.
  const quote = (text: string) => `'${text.replaceAll("'", "'\\''")}'`;
  const launcher = `#!/bin/sh\nexec ${quote(process.execPath)} ${source ? `--import ${quote(import.meta.resolve('tsx'))} ` : ''}${quote(entry)} "$@"\n`;
  const clients = new Set<Socket>();
  const pending = new Set<Promise<void>>();
  let active = false;
  const server = createServer((client) => {
    clients.add(client);
    let input = '';
    client.setEncoding('utf8');
    client.setTimeout(10_000, () => client.destroy());
    client.on('error', () => undefined);
    client.on('close', () => clients.delete(client));
    client.on('data', (chunk: string) => {
      input += chunk;
      if (input.length > 1024) return void client.destroy();
      if (!input.endsWith('\n')) return;
      client.removeAllListeners('data');
      const task = (async () => {
        const request = JSON.parse(input);
        if (
          active ||
          request.token !== token ||
          ![request.base, request.current, request.commit].every(
            (oid) => typeof oid === 'string' && /^[a-f0-9]{40,64}$/.test(oid),
          )
        )
          throw new Error('Invalid or concurrent private Rowbly replay request');
        active = true;
        try {
          const tree = await prepare({ base: request.base, current: request.current, commit: request.commit });
          if (!/^[a-f0-9]{40,64}$/.test(tree)) throw new Error('Invalid prepared replay tree');
          client.end(`${JSON.stringify({ tree })}\n`);
        } finally {
          active = false;
        }
      })().catch((err: unknown) =>
        client.end(`${JSON.stringify({ error: err instanceof Error ? err.message : String(err) })}\n`),
      );
      const settled = task.then(() => undefined);
      pending.add(settled);
      void settled.finally(() => pending.delete(settled));
    });
  });
  const temporary = resolve(tmpdir());
  // Include mkdtemp's suffix AND the bind alias in the byte budget (macOS permits 103 bytes).
  const parent = Buffer.byteLength(join(temporary, 'rowbly-XXXXXX', 'b', 's')) <= 100 ? temporary : '/tmp';
  const endpoint = await mkdtemp(join(parent, 'rowbly-'));
  const path = join(endpoint, 's'),
    alias = join(endpoint, 'b'),
    bind = join(alias, 's');
  let ownedDirectory: Stats | undefined, ownedAlias: Stats | undefined, ownedSocket: Stats | undefined;
  const assertDirectory = async () => {
    const current = await readEntry(endpoint);
    if (!sameEntry(current, ownedDirectory) || !current?.isDirectory() || current.uid !== process.getuid?.())
      throw new Error('Private Rowbly replay directory ownership changed');
  };
  const detach = async () => {
    await assertDirectory();
    const current = await readEntry(alias);
    if (current === undefined) return;
    if (!sameEntry(current, ownedAlias) || !current.isSymbolicLink())
      throw new Error('Private Rowbly replay bind alias ownership changed');
    await io.unlink(alias);
  };
  let closing: Promise<void> | undefined;
  const close = () =>
    (closing ??= (async () => {
      for (const client of clients) client.destroy();
      try {
        // Node close unlinks its bind pathname. Detach the alias first, even on setup failure.
        await detach();
        if (server.listening)
          await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
      } finally {
        // Liveness only: unref does NOT prevent libuv unlink during graceful process teardown.
        server.unref();
        await Promise.allSettled(pending);
      }
      await assertDirectory();
      const current = await readEntry(path);
      if (current !== undefined) {
        if (!sameEntry(current, ownedSocket) || !current.isSocket())
          throw new Error('Private Rowbly replay socket ownership changed');
        await io.unlink(path);
      }
      await io.rmdir(endpoint);
    })());
  try {
    ownedDirectory = await io.lstat(endpoint);
    await assertDirectory();
    await chmod(endpoint, 0o700);
    if (Buffer.byteLength(bind) > 100) throw new Error('Private Rowbly replay endpoint exceeds its path limit');
    await symlink('.', alias);
    ownedAlias = await io.lstat(alias);
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(bind, () => {
        server.removeListener('error', reject);
        resolve();
      });
    });
    ownedSocket = await io.lstat(path);
    await detach();
    await chmod(path, 0o600);
    await io.writeFile(join(directory, 'git-merge-rowbly-sync'), launcher, 'wx', 0o700);
  } catch (error) {
    try {
      await close();
    } catch (cleanup) {
      throw new AggregateError(
        [error, cleanup],
        `${error instanceof Error ? error.message : String(error)}; replay cleanup failed: ${cleanup instanceof Error ? cleanup.message : String(cleanup)}`,
      );
    }
    throw error;
  }
  return {
    environment: {
      ROWBLY_REBASE_SOCKET: path,
      ROWBLY_REBASE_TOKEN: token,
      PATH: `${directory}:${process.env.PATH ?? ''}`,
    },
    close,
  };
}
