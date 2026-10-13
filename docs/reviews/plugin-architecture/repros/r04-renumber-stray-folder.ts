// doctor --fix renumbers a duplicate-key Story into a key whose folder already exists (only Plugin files, no story.json).
import { mkdir, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { makeRoot, makeStory, withPlugins, show, writeJsonFixture } from './lib';
import { StorySchema } from '/home/sgolovine/Projects/rowbly/src/schemas';

const t = await makeRoot({});
await makeStory(t.path, { boardId: 'web', key: 'WEB-1', name: 'Kept' });
const later = await makeStory(t.path, { boardId: 'web', key: 'WEB-1', name: 'Moved', rank: 'a1', createdAt: '2026-10-13T00:00:00.000Z' });
await writeJsonFixture(join(t.path, 'boards/web/stories/WEB-7/story.json'), StorySchema, later);
await makeStory(t.path, { boardId: 'web', key: 'WEB-1', name: 'Kept' });
// A stray folder at the key doctor will pick next (WEB-8): a leftover Spec, no story.json.
await mkdir(join(t.path, 'boards/web/stories/WEB-8/plugins/specs'), { recursive: true });
await writeFile(join(t.path, 'boards/web/stories/WEB-8/plugins/specs/spec.md'), '# old');
const { services } = await withPlugins(t, []);
show('doctor check', (await services.doctor.check()).findings.map((f) => `${f.code} ${f.path}${f.fixable ? ' (fixable)' : ''}`));
const err = await services.doctor.fix().catch((e) => e);
show('doctor --fix result', err instanceof Error ? `${err.constructor.name}: ${(err as any).code} ${err.message}` : err);
show('stories folder afterwards', await readdir(join(t.path, 'boards/web/stories')));
show('stories list afterwards', (await services.stories.list('web', {})).map((s) => `${s.key} ${s.name}`));
show('doctor check afterwards', (await services.doctor.check()).findings.map((f) => `${f.severity} ${f.code} ${f.path}`));
await t.cleanup();
