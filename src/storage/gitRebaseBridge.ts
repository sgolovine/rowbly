import { randomBytes } from 'node:crypto';
import { createServer, type Socket } from 'node:net';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { io } from './io';

export interface GitReplayStep {
  base: string;
  current: string;
  commit: string;
}

/** One bounded bridge for an owned standalone Git context; not a Plugin capability. */
export async function openRebaseBridge(
  directory: string,
  prepare: (step: GitReplayStep) => Promise<string>,
): Promise<{ environment: Record<string, string>; close(): Promise<void> }> {
  const token = randomBytes(16).toString('hex');
  const path = join(directory, 'replay.sock');
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
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(path, () => {
      server.removeListener('error', reject);
      resolve();
    });
  });
  const close = async () => {
    for (const client of clients) client.destroy();
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    await Promise.allSettled(pending);
    await io.rm(path);
  };
  try {
    await io.writeFile(join(directory, 'git-merge-rowbly-sync'), launcher, 'wx', 0o700);
  } catch (error) {
    await close();
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
