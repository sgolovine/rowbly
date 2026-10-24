import { connect } from 'node:net';
import { gitText } from './gitProcess';

/** Private strategy entry. Git owns replay commits; the parent supplies one validated tree. */
async function main(): Promise<void> {
  const [base, separator, current, commit, ...rest] = process.argv.slice(2);
  const socket = process.env.ROWBLY_REBASE_SOCKET;
  const token = process.env.ROWBLY_REBASE_TOKEN;
  if (
    !socket ||
    !token ||
    separator !== '--' ||
    rest.length ||
    ![base, current, commit].every((oid) => /^[a-f0-9]{40,64}$/.test(oid ?? ''))
  )
    throw new Error('Invalid private Rowbly replay invocation');
  const tree = await new Promise<string>((resolve, reject) => {
    const client = connect(socket);
    let input = '';
    const timer = setTimeout(() => client.destroy(new Error('Rowbly replay bridge timed out')), 10_000);
    client.setEncoding('utf8');
    client.on('connect', () => client.write(`${JSON.stringify({ token, base, current, commit })}\n`));
    client.on('data', (chunk: string) => {
      input += chunk;
      if (input.length > 16_384) client.destroy(new Error('Oversized Rowbly replay response'));
      if (!input.endsWith('\n')) return;
      try {
        const result = JSON.parse(input);
        if (typeof result.error === 'string') throw new Error(result.error);
        if (!/^[a-f0-9]{40,64}$/.test(result.tree)) throw new Error('Invalid Rowbly replay tree');
        resolve(result.tree);
        client.end();
      } catch (err) {
        client.destroy(err as Error);
      }
    });
    client.on('error', reject);
    client.on('close', () => {
      clearTimeout(timer);
      reject(new Error('Rowbly replay host disconnected'));
    });
  });
  // This is an owned standalone context, never the user's index or working tree.
  await gitText(process.cwd(), ['read-tree', '--reset', '-u', tree]);
}

void main().catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = 2;
});
