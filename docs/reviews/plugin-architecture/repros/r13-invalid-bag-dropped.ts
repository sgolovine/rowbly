// A Story whose Epics bag is invalid (e.g. written by a newer Epics version): what does editing it in the TUI form send?
import { epics } from '/home/sgolovine/Projects/rowbly/src/plugins/epics';
import { specs } from '/home/sgolovine/Projects/rowbly/src/plugins/specs';
import { makeRoot, makeStory, withPlugins, show, readJson } from './lib';

const t = await makeRoot({ epics: true, specs: true });
await makeStory(t.path, { boardId: 'web', key: 'WEB-1', plugins: { epics: { epic: 'Not A Slug', extra: 'v2 field' }, specs: { specs: 'not-an-array' } } });
const { services } = await withPlugins(t, [epics, specs]);
const story = await services.stories.get('WEB-1');
const epicsTui = (await import('/home/sgolovine/Projects/rowbly/src/plugins/epics/tui')).tui;
const specsTui = (await import('/home/sgolovine/Projects/rowbly/src/plugins/specs/tui')).tui;
const ep = services.plugins.context('epics');
const sp = services.plugins.context('specs');
const epicFields = await epicsTui.storyForm!.fields({ boardId: 'web', story, plugin: ep });
const specFields = await specsTui.storyForm!.fields({ boardId: 'web', story, plugin: sp });
show('form fields shown to the user (initial values)', { epic: epicFields[0]?.value, specs: specFields[0]?.value });
// The user changes only the name and saves: the form passes each Plugin its own (untouched) values.
const epicInput = epicsTui.storyForm!.input({ epic: epicFields[0]!.value! }, story);
const specInput = specsTui.storyForm!.input({ specs: specFields[0]!.value! }, story);
show('Plugin input sent with the save', { epics: epicInput, specs: specInput });
await services.stories.update('WEB-1', { name: 'Only the name changed', plugins: { epics: epicInput, specs: specInput } });
show('bags on disk afterwards', (await readJson(t.path, 'boards/web/stories/WEB-1/story.json')).plugins ?? 'NONE (dropped)');
show('doctor afterwards', (await services.doctor.check()).findings.map((f) => `${f.code}: ${f.message}`));
await t.cleanup();
