import { definePlugin } from '/home/sgolovine/Projects/rowbly/src/plugin-api';
import { makeRoot, makeStory, withPlugins, show, readJson } from './lib';
import { notes } from '/home/sgolovine/Projects/rowbly/test/plugins/fixtures/notes';
import { StorySchema } from '/home/sgolovine/Projects/rowbly/src/schemas';
import { writeJsonFixture } from './lib';
import { join } from 'node:path';

// A: command mode waits for a reaction that never settles.
const hang = definePlugin({ id: 'hang', name: 'Hang', description: '', hooks: { 'boards.update': { react: () => new Promise<void>(() => {}) } } });
{
  const t = await makeRoot({ hang: true });
  const { services } = await withPlugins(t, [hang]);
  const outcome = await Promise.race([
    services.boards.update('web', { name: 'X' }).then(() => 'operation returned'),
    new Promise((r) => setTimeout(() => r('still waiting after 1500 ms (CLI would never exit)'), 1500)),
  ]);
  show('A: hanging reaction', outcome);
  show('A: saved anyway?', (await readJson(t.path, 'boards/web/board.config.json')).name);
  await t.cleanup();
}
// B: one broken Plugin fix in a pass blocks the core fixes of that pass.
const brokenFix = definePlugin({
  id: 'broken',
  name: 'Broken',
  description: '',
  doctor: {
    check: ({ data }) => data.stories.map((s) => ({ code: 'ALWAYS', severity: 'warning' as const, path: 'x', message: 'always', fix: async () => { throw new TypeError('plugin fix bug'); } })),
  },
});
{
  const t = await makeRoot({ broken: true });
  await makeStory(t.path, { boardId: 'web', key: 'WEB-1', name: 'Kept' });
  const later = await makeStory(t.path, { boardId: 'web', key: 'WEB-1', name: 'Dup', rank: 'a1', createdAt: '2026-10-13T00:00:00.000Z' });
  await writeJsonFixture(join(t.path, 'boards/web/stories/WEB-7/story.json'), StorySchema, later);
  await makeStory(t.path, { boardId: 'web', key: 'WEB-1', name: 'Kept' });
  const { services } = await withPlugins(t, [brokenFix]);
  show('B: check', (await services.doctor.check()).findings.map((f) => `${f.code} ${f.fixable ? '(fixable)' : ''}`));
  show('B: fix', await services.doctor.fix().then((r) => r, (e) => `ERR ${e.constructor.name} (${e.code}): ${e.message}`));
  show('B: DUPLICATE_KEY still there?', (await services.doctor.check()).findings.map((f) => f.code));
  await t.cleanup();
}
process.exit(0);
