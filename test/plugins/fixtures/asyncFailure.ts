// Run in a child process by test/plugins/asyncFailure.test.ts (RES-18B): in `awaited` a transform
// awaits its failing work, so the operation fails cleanly; in `detached` a reaction leaves a timer
// that throws after the operation has saved, which no Rowbly catch can see and which ends the process.
import { createServices, loadPlugins } from '../../../src/services';
import { definePlugin } from '../../../src/plugin-api';
import { fixedClock, fixedIds } from '../../helpers/clock';
import { reservedNames } from '../../../src/main';
import type { DataRoot } from '../../../src/schemas';

const [mode, rootPath] = process.argv.slice(2) as ['awaited' | 'detached', string];

const plugin = definePlugin({
  id: 'async',
  name: 'Async',
  description: '',
  hooks: {
    'stories.update': {
      async transform() {
        if (mode === 'awaited') await Promise.reject(new Error('awaited boom'));
      },
      react() {
        if (mode === 'detached') {
          setTimeout(() => {
            throw new Error('detached boom');
          }, 0);
        }
      },
    },
  },
});

const root: DataRoot = { path: rootPath, kind: 'local' };
const host = await loadPlugins({ root, registry: [plugin], reserved: reservedNames() });
const services = createServices({
  root,
  local: { version: 1 },
  me: null,
  now: fixedClock().now,
  newId: fixedIds(),
  warn: (message) => process.stderr.write(`warning: ${message}\n`),
  plugins: host,
});
try {
  const story = await services.stories.update('WEB-1', { name: 'Renamed' });
  process.stdout.write(`saved ${story.name}\n`);
} catch (err) {
  process.stdout.write(`failed ${(err as { code?: string }).code}: ${(err as Error).message}\n`);
}
