// One unreadable Epic file (merge conflict markers / bad JSON / future version): what breaks, and does doctor notice?
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { epics } from '/home/sgolovine/Projects/rowbly/src/plugins/epics';
import { makeRoot, makeStory, withPlugins, show } from './lib';

const t = await makeRoot({ epics: true });
await makeStory(t.path, { boardId: 'web', key: 'WEB-1' });
await mkdir(join(t.path, 'plugins/epics'), { recursive: true });
await writeFile(join(t.path, 'plugins/epics/good.json'), JSON.stringify({ version: 1, id: 'good', name: 'Good', description: '', closed: false, createdAt: '2026-10-12T17:21:07.000Z', updatedAt: '2026-10-12T17:21:07.000Z' }));
await writeFile(join(t.path, 'plugins/epics/bad.json'), '<<<<<<< HEAD\n{"version":1}\n=======\n{"version":1}\n>>>>>>> other\n');
const { services } = await withPlugins(t, [epics]);
const plugin = services.plugins.context('epics');
const { listEpics } = await import('/home/sgolovine/Projects/rowbly/src/plugins/epics/service');
show('epics list', await listEpics(plugin, 'all').then((l) => l.map((e) => e.id), (e) => `ERR ${e.constructor.name}: ${e.message}`));
const { tui } = await import('/home/sgolovine/Projects/rowbly/src/plugins/epics/tui');
show('TUI story form fields', await tui.storyForm!.fields({ boardId: 'web', story: null, plugin }).then((f) => f, (e) => `ERR ${e.constructor.name}: ${e.message}`));
show('TUI story filter fields', await tui.storyFilter!.fields({ boardId: 'web', plugin }).then((f) => f, (e) => `ERR ${e.constructor.name}: ${e.message}`));
show('doctor', (await services.doctor.check()).findings.map((f) => `${f.severity} ${f.code} ${f.path}: ${f.message}`));
await t.cleanup();
