// A real second host writes while another process prepares a synchronization candidate.
import { reservedNames } from '../../../src/main';
import { comments } from '../../../src/plugins/comments';
import { git } from '../../../src/plugins/git';
import { configure } from '../../../src/plugins/git/model';
import { createServices, loadPlugins } from '../../../src/services';
import { drainGitQueue } from '../../../src/services/plugins/git';

const [path, key] = process.argv.slice(2);
if (!path || !key) throw new Error('Expected Data Root and Story key');
const root = { path, kind: 'local' as const };
let reacted = 0;
let ready: () => void = () => undefined;
const reactions = new Promise<void>((resolve) => {
  ready = resolve;
});
const observed: typeof git = {
  ...git,
  async react(event) {
    await git.react?.(event);
    if (++reacted === 2) ready();
  },
};
const host = await loadPlugins({ root, registry: [observed, comments], reserved: reservedNames() });
const services = createServices({
  root,
  local: { version: 1 },
  me: null,
  now: () => new Date(),
  newId: () => 'concurrent-writer',
  warn: (message) => process.stderr.write(`${message}\n`),
  plugins: host,
  backgroundReactions: true,
});
try {
  await configure(services.plugins.context('git'), { automaticCommits: true });
  await services.stories.update(key, { name: 'Later accepted edit' });
  await reactions;
  process.send?.('saved');
  await drainGitQueue(root);
} finally {
  host.dispose?.();
  process.disconnect?.();
}
