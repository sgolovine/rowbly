// A crash between the two phases of moveFolders leaves `.xxxx.moving`. What does the app and doctor show?
import { rename } from 'node:fs/promises';
import { join } from 'node:path';
import { makeRoot, makeStory, withPlugins, show } from './lib';

const t = await makeRoot({});
await makeStory(t.path, { boardId: 'web', key: 'WEB-1', name: 'Visible' });
await makeStory(t.path, { boardId: 'web', key: 'WEB-2', name: 'Was being renumbered', rank: 'a1' });
await rename(join(t.path, 'boards/web/stories/WEB-2'), join(t.path, 'boards/web/stories/.ab12cd34.moving'));
const { services } = await withPlugins(t, []);
show('stories list', (await services.stories.list('web', {})).map((s) => `${s.key} ${s.name}`));
show('doctor', (await services.doctor.check()).findings.map((f) => `${f.severity} ${f.code} ${f.path}: ${f.message}`));
show('next created key', (await services.stories.create('web', { name: 'new' })).key);
await t.cleanup();
