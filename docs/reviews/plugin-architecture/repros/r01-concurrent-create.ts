// Two independent service instances over the same Data Root (two CLIs, or TUI + CLI) create a Story at once.
import { makeRoot, withPlugins, show } from './lib';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

const t = await makeRoot({});
const a = await withPlugins(t, []);
const b = await withPlugins(t, []);
const [sa, sb] = await Promise.all([
  a.services.stories.create('web', { name: 'From A' }),
  b.services.stories.create('web', { name: 'From B' }),
]);
show('keys returned', [sa.key, sb.key]);
show('story folders on disk', await readdir(join(t.path, 'boards/web/stories')));
show('stories list', (await a.services.stories.list('web', {})).map((s) => `${s.key} ${s.name}`));
await t.cleanup();
