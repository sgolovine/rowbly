// A transform that calls a core operation (docs say "do not"). Is it prevented? What happens?
import { definePlugin } from '/home/sgolovine/Projects/rowbly/src/plugin-api';
import { makeRoot, makeStory, withPlugins, show, readJson } from './lib';

// Case 1: a transform on stories.update that calls stories.update on the same Story (different field).
let depth = 0;
const nested = definePlugin({
  id: 'nested',
  name: 'Nested',
  description: '',
  hooks: {
    'stories.update': {
      async transform({ input, plugin }) {
        depth++;
        if (depth > 5) throw new Error(`recursion depth ${depth}`);
        if (input.description === 'from-hook') return; // stop the loop after one nested call
        await plugin.services.stories.update(input.key, { description: 'from-hook' });
      },
    },
  },
});
{
  const t = await makeRoot({ nested: true });
  await makeStory(t.path, { boardId: 'web', key: 'WEB-1' });
  const { services } = await withPlugins(t, [nested]);
  const result = await services.stories.update('WEB-1', { name: 'Renamed by caller' }).catch((e) => `ERR ${e.message}`);
  show('case 1: result of outer update', typeof result === 'string' ? result : { name: result.name, description: result.description });
  show('case 1: on disk', (({ name, description }) => ({ name, description }))(await readJson(t.path, 'boards/web/stories/WEB-1/story.json')));
  show('case 1: nested depth reached', depth);
  await t.cleanup();
}
// Case 2: unbounded recursion: a transform that always calls the same operation.
depth = 0;
const loop = definePlugin({
  id: 'loop',
  name: 'Loop',
  description: '',
  hooks: {
    'boards.update': {
      async transform({ input, plugin }) {
        depth++;
        if (depth > 50) throw new Error(`gave up at depth ${depth}`);
        await plugin.services.boards.update(input.id, { description: `d${depth}` });
      },
    },
  },
});
{
  const t = await makeRoot({ loop: true });
  const { services } = await withPlugins(t, [loop]);
  const result = await services.boards.update('web', { name: 'X' }).catch((e) => `ERR ${e.message}`);
  show('case 2: result', typeof result === 'string' ? result : result.name);
  show('case 2: depth reached before the guard in the fixture stopped it', depth);
  show('case 2: on disk', (({ name, description }) => ({ name, description }))(await readJson(t.path, 'boards/web/board.config.json')));
  await t.cleanup();
}
