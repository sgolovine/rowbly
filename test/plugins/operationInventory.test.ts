// ARCH-02: docs/OPERATIONS.md is the one operation inventory. A recorder Plugin hooks every operation
// the inventory lists, the built-ins run each of their mutations, and what they emit must match.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PluginError } from '../../src/core';
import { CORE_OPERATION_NAMES, definePlugin } from '../../src/plugin-api';
import { comments } from '../../src/plugins/comments';
import { addComment, deleteComment, editComment } from '../../src/plugins/comments/comments';
import { epics } from '../../src/plugins/epics';
import { createEpic, deleteEpic, editEpic, setEpicClosed } from '../../src/plugins/epics/service';
import { specs } from '../../src/plugins/specs';
import { createSpec, deleteSpec, editSpec } from '../../src/plugins/specs/specs';
import { makeStory } from '../helpers';
import { pluginRoot, withPlugins } from './helpers';

const INVENTORY = fileURLToPath(new URL('../../docs/OPERATIONS.md', import.meta.url));

/** The rows of the table under `## <heading>`: operation name → its input keys, `?` for optional. */
async function inventory(heading: string): Promise<Map<string, { required: string[]; optional: string[] }>> {
  const text = await readFile(INVENTORY, 'utf8');
  const section = text.split(`## ${heading}\n`)[1]?.split('\n## ')[0] ?? '';
  const rows = new Map<string, { required: string[]; optional: string[] }>();
  for (const [, name = '', input = ''] of section.matchAll(/^\| `([a-z-]+\.[a-zA-Z-]+)` \| `\{ ?([^}]*?) ?\}` \|/gm)) {
    const keys = input
      .split(',')
      .map((key) => key.trim())
      .filter((key) => key !== '' && !key.startsWith('…'));
    rows.set(name, {
      required: keys.filter((key) => !key.endsWith('?')),
      optional: keys.filter((key) => key.endsWith('?')).map((key) => key.slice(0, -1)),
    });
  }
  return rows;
}

describe('the operation inventory (ARCH-02)', () => {
  it('lists every core operation, in order', async () => {
    expect([...(await inventory('Core operations')).keys()]).toEqual([...CORE_OPERATION_NAMES]);
  });

  it('matches the names and inputs every built-in mutation emits', async () => {
    const listed = await inventory('Built-in Plugin operations');
    const seen: { name: string; keys: string[] }[] = [];
    const record = {
      react({ name, input }: { name: string; input: object }) {
        seen.push({ name, keys: Object.keys(input).filter((key) => key !== 'plugins') });
      },
    };
    const recorder = definePlugin({
      id: 'rec',
      name: 'Recorder',
      description: '',
      hooks: Object.fromEntries([...listed.keys()].map((name) => [name, record])),
    });
    const t = await pluginRoot({ epics: true, specs: true, comments: true, rec: true });
    await makeStory(t.path, { boardId: 'web', key: 'WEB-1' });
    const { services } = await withPlugins(t, [epics, specs, comments, recorder]);
    const epic = services.plugins.context('epics');
    const spec = services.plugins.context('specs');
    const comment = services.plugins.context('comments');

    await createEpic(epic, { id: 'auth', name: 'Auth' });
    await editEpic(epic, 'auth', { name: 'Authentication' });
    await setEpicClosed(epic, 'auth', true);
    await setEpicClosed(epic, 'auth', false);
    await deleteEpic(epic, 'auth');
    await createSpec(spec, { board: 'web', slug: 'login' }, '# Login');
    await editSpec(spec, { board: 'web', slug: 'login' }, '# Login\n\nMore');
    await createSpec(spec, { board: 'web', story: 'WEB-1' }, '# Story');
    await deleteSpec(spec, { board: 'web', story: 'WEB-1' });
    await deleteSpec(spec, { board: 'web', slug: 'login' });
    const added = await addComment(comment, 'WEB-1', 'Hello');
    await editComment(comment, 'WEB-1', added.id, 'Hello again');
    await deleteComment(comment, 'WEB-1', added.id);

    expect(new Set(seen.map((s) => s.name))).toEqual(new Set(listed.keys()));
    for (const { name, keys } of seen) {
      const row = listed.get(name);
      expect(row, name).toBeDefined();
      if (!row) continue;
      expect(
        keys.filter((key) => !row.required.includes(key) && !row.optional.includes(key)),
        name,
      ).toEqual([]);
      expect(
        row.required.filter((key) => !keys.includes(key)),
        name,
      ).toEqual([]);
    }
  });

  it('a malformed local operation name fails before anything is saved', async () => {
    const t = await pluginRoot({ epics: true });
    const { services } = await withPlugins(t, [epics]);
    const plugin = services.plugins.context('epics');
    for (const name of ['', 'epics.create', 'Create', 'a/b']) {
      const err = await plugin
        .operation(name, {}, (changes) => changes.writeFile('dataRoot', 'x.json', '{}'))
        .catch((e: unknown) => e);
      expect(err, name).toBeInstanceOf(PluginError);
      expect(err).toMatchObject({ details: { plugin: 'epics', operation: name } });
    }
    expect(await plugin.files.list('dataRoot')).toEqual([]);
  });
});
