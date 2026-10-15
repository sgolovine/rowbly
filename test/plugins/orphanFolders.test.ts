// RES-07 (`r05-orphan-adoption`), allocation part: a Story folder without its story.json still
// reserves its Story Key, so a new Story never adopts the Plugin files left in it. Listing stays
// strict. WP03 adds the doctor diagnosis.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { specs } from '../../src/plugins/specs';
import { pluginRoot, withPlugins } from './helpers';

const ORPHAN = 'boards/web/stories/WEB-1';

describe('Story Key allocation', () => {
  it('skips a folder that has Plugin files but no story.json (r05)', async () => {
    const t = await pluginRoot({ specs: true });
    for (const [plugin, file, text] of [
      ['specs', 'spec.md', '# Spec of a Story deleted long ago\n'],
      ['retired', 'old.txt', 'a Plugin that is off'],
    ] as const) {
      await mkdir(join(t.path, ORPHAN, 'plugins', plugin), { recursive: true });
      await writeFile(join(t.path, ORPHAN, 'plugins', plugin, file), text);
    }
    const { services } = await withPlugins(t, [specs]);

    const created = await services.stories.create('web', { name: 'Brand new Story' });
    expect(created.key).toBe('WEB-2');
    expect(await services.plugins.context('specs').files.read({ story: created.key }, 'spec.md')).toBeNull();
    expect(await readFile(join(t.path, ORPHAN, 'plugins/specs/spec.md'), 'utf8')).toContain('deleted long ago');
    expect(await readFile(join(t.path, ORPHAN, 'plugins/retired/old.txt'), 'utf8')).toBe('a Plugin that is off');
    // Listing stays strict: the orphan folder is not a Story.
    expect((await services.stories.list('web', {})).map((s) => s.key)).toEqual(['WEB-2']);
  });

  it('skips an orphan above the highest Story, and ignores folders that are not Story Keys', async () => {
    const t = await pluginRoot();
    await mkdir(join(t.path, 'boards/web/stories/WEB-7'), { recursive: true });
    await mkdir(join(t.path, 'boards/web/stories/notes'), { recursive: true });
    await mkdir(join(t.path, 'boards/web/stories/API-9'), { recursive: true });
    const { services } = await withPlugins(t, []);
    expect((await services.stories.create('web', { name: 'A' })).key).toBe('WEB-8');
  });
});
