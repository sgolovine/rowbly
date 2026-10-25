// Subprocess for transaction.test.ts: `killAt.ts commit|recover <root> <plan.json> <checkpoint>`
// commits the plan (or recovers the root) and SIGKILLs itself at the named durable checkpoint.
import { readFile } from 'node:fs/promises';
import { prepareTransaction, recoverTransactions, type TransactionCheckpoint } from '../../../src/storage';

const [mode, root, planPath, target] = process.argv.slice(2) as [string, string, string, string];
const onCheckpoint = (point: TransactionCheckpoint) => {
  if (point === target) process.kill(process.pid, 'SIGKILL');
};
if (mode === 'commit') {
  const plan = JSON.parse(await readFile(planPath, 'utf8'));
  for (const change of plan.changes) {
    if (change.kind === 'write' && typeof change.text !== 'string') {
      change.text = await readFile(change.text.payload);
    }
  }
  await (await prepareTransaction(root, plan, { onCheckpoint })).commit();
} else {
  await recoverTransactions(root, { onCheckpoint });
}
