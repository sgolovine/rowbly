// Subprocess for lock.test.ts.
//   holdLock.ts hold <root>            takes the lock, prints "locked", releases when stdin ends
//   holdLock.ts die <root>             takes the lock, prints "locked", then is SIGKILLed
//   holdLock.ts turns <root> <log> <id> <n>  n times: take the lock, append "in <id>" and
//                                      "out <id>" around a short hold, release
import { appendFile } from 'node:fs/promises';
import { acquireLock } from '../../../src/storage';

const [mode, root, log, id, turns] = process.argv.slice(2) as [string, string, string, string, string];
if (mode === 'turns') {
  for (let n = 0; n < Number(turns); n++) {
    const lock = await acquireLock(root, { timeoutMs: 30_000, operation: `turn ${id}` });
    await appendFile(log, `in ${id}\n`);
    await new Promise((resolve) => setTimeout(resolve, 5));
    await appendFile(log, `out ${id}\n`);
    await lock.release();
  }
} else {
  const lock = await acquireLock(root, { operation: 'hold' });
  process.stdout.write('locked\n');
  if (mode === 'die') process.kill(process.pid, 'SIGKILL');
  process.stdin.resume();
  process.stdin.on('end', async () => {
    await lock.release();
    process.stdout.write('released\n');
  });
}
