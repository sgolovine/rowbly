// A bag that is not an object (array / scalar / null), e.g. from a hand edit or another tool.
import { makeRoot, makeStory, withPlugins, show } from './lib';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const t = await makeRoot({});
await makeStory(t.path, { boardId: 'web', key: 'WEB-1' });
const good = await makeStory(t.path, { boardId: 'web', key: 'WEB-2', rank: 'a1' });
await writeFile(join(t.path, 'boards/web/stories/WEB-2/story.json'), JSON.stringify({ ...good, plugins: { ghost: [1, 2] } }, null, 2));
const { services } = await withPlugins(t, []);
show('stories list web', await services.stories.list('web', {}).then((l) => l.map((s) => s.key), (e) => `ERR ${e.constructor.name} (${e.code}): ${e.message}`));
show('stories get WEB-1 (the healthy one)', await services.stories.get('WEB-1').then((s) => s.key, (e) => `ERR ${e.message}`));
show('stories create (needs maxNumber → allInBoard)', await services.stories.create('web', { name: 'x' }).then((s) => s.key, (e) => `ERR ${e.constructor.name} (${e.code}): ${e.message}`));
show('doctor', (await services.doctor.check()).findings.map((f) => `${f.severity} ${f.code} ${f.path}: ${f.message}`));
await t.cleanup();
