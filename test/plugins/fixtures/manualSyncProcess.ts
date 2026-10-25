// A second process joins an exact manual request through a lexical alias of the same Data Root.
import { setTimeout } from 'node:timers/promises';
import { comments } from '../../../src/plugins/comments';
import { git } from '../../../src/plugins/git';
import { resolveSyncOptions } from '../../../src/plugins/git/model';
import { createGitSync, disposeSyncOwner, drainSyncQueue } from '../../../src/services/plugins/gitSync';

const [path] = process.argv.slice(2);
if (!path) throw new Error('Expected Data Root');
const root = { path, kind: 'local' as const },
  host = {};
const sync = createGitSync(root, 'git', [git, comments], console.error, host);
const result = sync.requestRebaseSync(resolveSyncOptions);
try {
  // Observe persisted admission before the parent releases the older automatic run.
  while (true) {
    const state = await sync.syncStatus(resolveSyncOptions);
    if (state.manual) {
      process.send?.({ pending: state.manual.id });
      break;
    }
    await setTimeout(10);
  }
  process.send?.({ result: await result });
} finally {
  disposeSyncOwner(host);
  await drainSyncQueue(root);
  process.disconnect?.();
}
