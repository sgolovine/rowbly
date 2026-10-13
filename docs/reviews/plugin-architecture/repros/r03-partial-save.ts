// Multi-record Change Set whose save fails halfway: is anything rolled back?
import { chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { definePlugin } from '/home/sgolovine/Projects/rowbly/src/plugin-api';
import { makeRoot, makeStory, withPlugins, show, readJson } from './lib';

// Case A: a transform mutates `change.after` in place (bypassing putStory validation) for the 2nd Story.
const mutator = definePlugin({
  id: 'mutator',
  name: 'Mutator',
  description: '',
  hooks: {
    'assignees.remove': {
      transform({ changes }) {
        const stories = changes.changes.filter((c) => c.type === 'story');
        const second = stories[1];
        if (second?.type === 'story' && second.after) (second.after as any).name = ''; // invalid: min(1)
      },
    },
  },
});
{
  const t = await makeRoot({ mutator: true }, { assignees: [{ handle: 'alice', name: 'A' }, { handle: 'bob', name: 'B' }] });
  for (const n of [1, 2, 3]) await makeStory(t.path, { boardId: 'web', key: `WEB-${n}`, rank: `a${n}`, assignees: ['bob'] });
  const { services } = await withPlugins(t, [mutator]);
  const err = await services.assignees.remove('bob').catch((e) => e);
  show('A: error', `${err?.constructor?.name}: ${err?.message}`);
  for (const n of [1, 2, 3]) show(`A: WEB-${n} assignees on disk`, (await readJson(t.path, `boards/web/stories/WEB-${n}/story.json`)).assignees);
  show('A: roster on disk', (await readJson(t.path, 'rowbly.config.json')).assignees.map((a: any) => a.handle));
  await t.cleanup();
}
// Case B: a plain I/O failure (read-only Story folder) in the middle of an Epic deletion that unlinks 3 Stories.
{
  const { epics } = await import('/home/sgolovine/Projects/rowbly/src/plugins/epics');
  const t = await makeRoot({ epics: true });
  for (const n of [1, 2, 3]) await makeStory(t.path, { boardId: 'web', key: `WEB-${n}`, rank: `a${n}`, plugins: { epics: { epic: 'auth' } } });
  const { services } = await withPlugins(t, [epics]);
  const plugin = services.plugins.context('epics');
  const { createEpic, deleteEpic } = await import('/home/sgolovine/Projects/rowbly/src/plugins/epics/service');
  await createEpic(plugin, { id: 'auth', name: 'Auth' });
  await chmod(join(t.path, 'boards/web/stories/WEB-2'), 0o555);
  const err = await deleteEpic(plugin, 'auth').catch((e) => e);
  show('B: error', `${err?.constructor?.name}: ${err?.code ?? ''} ${err?.message}`);
  await chmod(join(t.path, 'boards/web/stories/WEB-2'), 0o755);
  for (const n of [1, 2, 3]) show(`B: WEB-${n} plugins on disk`, (await readJson(t.path, `boards/web/stories/WEB-${n}/story.json`)).plugins ?? 'none');
  show('B: epic file still exists', await plugin.files.list('dataRoot'));
  await t.cleanup();
}
// Case C: a transform pushes a raw change straight into `changes.changes` (no validation at all).
const pusher = definePlugin({
  id: 'pusher',
  name: 'Pusher',
  description: '',
  hooks: {
    'boards.update': {
      transform({ changes }) {
        (changes.changes as any[]).push({ type: 'file', plugin: 'somebody-else', path: 'plugins/somebody-else/../../hijacked.txt', before: null, after: 'owned' });
      },
    },
  },
});
{
  const t = await makeRoot({ pusher: true });
  const { services } = await withPlugins(t, [pusher]);
  const err = await services.boards.update('web', { name: 'X' }).catch((e) => e);
  show('C: error', err instanceof Error ? `${err.constructor.name}: ${err.message}` : 'none');
  const { readdir } = await import('node:fs/promises');
  show('C: Data Root entries', await readdir(t.path));
  await t.cleanup();
}
