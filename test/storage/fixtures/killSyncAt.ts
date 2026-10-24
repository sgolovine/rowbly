import { readFile } from 'node:fs/promises';
import { requireRepository, withGitWorker } from '../../../src/storage/gitRepository';
import { type PublicationPlan, publishPublication, withPublication } from '../../../src/storage/gitSyncJournal';

const [root, planPath, target] = process.argv.slice(2);
if (!root || !planPath || !target) throw new Error('Missing killed-publication fixture arguments');
const repo = await requireRepository({ path: root, kind: 'local' });
const plan = JSON.parse(await readFile(planPath, 'utf8')) as PublicationPlan;
await withGitWorker(repo, () =>
  withPublication(repo, (hold) =>
    publishPublication(hold, plan, {
      checkpoint(name) {
        if (name === target) process.kill(process.pid, 'SIGKILL');
      },
    }),
  ),
);
