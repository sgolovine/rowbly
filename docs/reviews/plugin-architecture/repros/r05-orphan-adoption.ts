// A Story folder without story.json (left by a merge or a hand deletion) still holds Plugin files.
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { specs } from '/home/sgolovine/Projects/rowbly/src/plugins/specs';
import { makeRoot, withPlugins, show } from './lib';

const t = await makeRoot({ specs: true });
await mkdir(join(t.path, 'boards/web/stories/WEB-1/plugins/specs'), { recursive: true });
await writeFile(join(t.path, 'boards/web/stories/WEB-1/plugins/specs/spec.md'), '# Spec of a Story that was deleted long ago\n');
const { services } = await withPlugins(t, [specs]);
show('doctor before', (await services.doctor.check()).findings);
const created = await services.stories.create('web', { name: 'Brand new Story' });
show('created key', created.key);
const plugin = services.plugins.context('specs');
show('Story Spec of the new Story (should be none)', await plugin.files.read({ story: created.key }, 'spec.md'));
await t.cleanup();
