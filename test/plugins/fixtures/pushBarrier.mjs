// A disposable remote's receive-pack waits for the parent to permit the actual push response.
import { spawn } from 'node:child_process';
import { connect } from 'node:net';

const socket = connect(process.argv[2]);
await new Promise((resolve, reject) => {
  socket.setTimeout(10_000, () => socket.destroy(new Error('Push barrier was not released')));
  socket.once('error', reject);
  socket.once('end', resolve);
  socket.resume();
});
const child = spawn('git', ['receive-pack', ...process.argv.slice(3)], { stdio: 'inherit' });
process.exitCode = await new Promise((resolve, reject) => {
  child.once('error', reject);
  child.once('exit', (code) => resolve(code ?? 1));
});
