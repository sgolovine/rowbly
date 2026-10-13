// doctor --fix: a core renumber and a Plugin fix in the same pass. The Plugin fix was built with the pre-renumber key.
import { join } from 'node:path';
import { epics } from '/home/sgolovine/Projects/rowbly/src/plugins/epics';
import { StorySchema } from '/home/sgolovine/Projects/rowbly/src/schemas';
import { makeRoot, makeStory, withPlugins, show, readJson, writeJsonFixture } from './lib';
import { mkdir, writeFile } from 'node:fs/promises';

const t = await makeRoot({ epics: true });
await mkdir(join(t.path, 'plugins/epics'), { recursive: true });
await writeFile(join(t.path, 'plugins/epics/real.json'), JSON.stringify({ version: 1, id: 'real', name: 'Real', description: '', closed: false, createdAt: '2026-10-12T17:21:07.000Z', updatedAt: '2026-10-12T17:21:07.000Z' }));
// The keeper WEB-1 links to a real Epic.
await makeStory(t.path, { boardId: 'web', key: 'WEB-1', name: 'Keeper', plugins: { epics: { epic: 'real' } } });
// A merge brought another Story keyed WEB-1 (created later) in folder WEB-7; it links to a missing Epic.
const dup = await makeStory(t.path, { boardId: 'web', key: 'WEB-1', name: 'Duplicate', rank: 'a1', createdAt: '2026-10-13T00:00:00.000Z', plugins: { epics: { epic: 'gone' } } });
await writeJsonFixture(join(t.path, 'boards/web/stories/WEB-7/story.json'), StorySchema, dup);
await makeStory(t.path, { boardId: 'web', key: 'WEB-1', name: 'Keeper', plugins: { epics: { epic: 'real' } } });

const { services } = await withPlugins(t, [epics]);
show('doctor check', (await services.doctor.check()).findings.map((f) => `${f.code} ${f.path}: ${f.message}`));
const report = await services.doctor.fix();
show('fixed', report.fixed.map((f) => `${f.code}: ${f.message}`));
show('remaining', report.findings.map((f) => `${f.code}: ${f.message}`));
show('WEB-1 (keeper) on disk', (({ name, plugins }) => ({ name, plugins }))(await readJson(t.path, 'boards/web/stories/WEB-1/story.json')));
show('WEB-8 (renumbered duplicate) on disk', (({ name, plugins }) => ({ name, plugins }))(await readJson(t.path, 'boards/web/stories/WEB-8/story.json')));
await t.cleanup();
