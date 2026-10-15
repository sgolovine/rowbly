// The Rowbly CLI (`main`) with the fixture Plugins plus a `barrier` Plugin, for tests that run two
// real CLI processes at once or kill one in the middle of a save.
//
// Environment:
//   BARRIER_DIR, BARRIER_SELF, BARRIER_PEER  In the first transform of a barrier operation, write
//       `<dir>/<self>.reached`, then wait until the peer has reached its transform too, or is waiting
//       for the Data Root lock (`<dir>/<peer>.blocked`, written when this program finds `.lock` taken).
//       Without coordination both processes plan from the same records before either saves. A
//       process that exits writes `<dir>/<self>.done`, so its peer never waits for it forever.
//   KILL_AT=<n>    SIGKILL this process at its n-th filesystem change (an `io` call that writes).
//   COUNT_CALLS=1  Print every filesystem change to stderr as `io <method> <path>`.
import { existsSync, writeFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { main } from '../../../src/main';
import { definePlugin } from '../../../src/plugin-api';
import { io } from '../../../src/storage/io';
import { fixturePlugins } from '../fixtures';

const { BARRIER_DIR: dir, BARRIER_SELF: self, BARRIER_PEER: peer, KILL_AT, COUNT_CALLS } = process.env;

const MUTATING = ['writeFile', 'rename', 'link', 'mkdir', 'unlink', 'rmdir', 'rm', 'syncDir'] as const;
let calls = 0;
for (const name of MUTATING) {
  const original = io[name] as (...args: unknown[]) => Promise<unknown>;
  (io as unknown as Record<string, unknown>)[name] = async (...args: unknown[]) => {
    calls += 1;
    if (COUNT_CALLS) process.stderr.write(`io ${name} ${String(args[0])}\n`);
    if (KILL_AT && calls === Number(KILL_AT)) process.kill(process.pid, 'SIGKILL');
    try {
      return await original(...args);
    } catch (err) {
      // The lock file is taken: this process now waits for the peer to finish.
      if (dir && name === 'link' && String(args[1]).endsWith('.lock')) {
        await writeFile(join(dir, `${self}.blocked`), '');
      }
      throw err;
    }
  };
}

let waited = false;
/** Waits once, at the first barrier transform, as the file header describes. */
async function barrier(): Promise<void> {
  if (!dir || waited) return;
  waited = true;
  await writeFile(join(dir, `${self}.reached`), '');
  const peerArrived = () => ['reached', 'blocked', 'done'].some((mark) => existsSync(join(dir, `${peer}.${mark}`)));
  while (!peerArrived()) await new Promise((resolve) => setTimeout(resolve, 5));
}

const transform = { transform: barrier };
const barrierPlugin = definePlugin({
  id: 'barrier',
  name: 'Barrier',
  description: 'Holds two processes at one point of an operation',
  hooks: {
    'stories.create': transform,
    'stories.update': transform,
    'assignees.add': transform,
    'barrier.append': transform,
  },
  commands(group, cli) {
    group
      .command('append <text>')
      .description('Append a line to log.txt in the Data Root')
      .action((text: string, _opts: unknown, cmd) =>
        cli.run(cmd, async ({ plugin, print }) => {
          await plugin.operation('append', { text }, async (changes) => {
            const before = (await changes.readFile('dataRoot', 'log.txt')) ?? '';
            await changes.writeFile('dataRoot', 'log.txt', `${before}${text}\n`);
          });
          print({ appended: text }, () => `Appended ${text}`);
        }),
      );
  },
});

if (dir) process.on('exit', () => writeFileSync(join(dir, `${self}.done`), ''));
process.exitCode = await main(process.argv.slice(2), [...fixturePlugins, barrierPlugin]);
