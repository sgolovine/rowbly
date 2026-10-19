// The Plugin author guide's examples (DX-03, DX-05, DOC-03): each TypeScript example in
// docs/plugins/writing-a-plugin.md and docs/plugins/api.md is a region of a fixture under test/docs/fixtures/,
// which `pnpm typecheck` compiles and this suite runs, so the guide cannot drift from the API.
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { main } from '../../src/main';
import { createPluginTestHost, validatePluginDefinition } from '../../src/plugin-api/testing';
import { makeBoard, makeStory } from '../helpers';
import { pluginRoot, readJsonFile, storyFile, withPlugins } from '../plugins/helpers';
import { focusListItem, openPluginApp } from '../plugins/tuiHelpers';
import { KEYS, waitForFrame } from '../tui/helpers';
import { hello } from './fixtures/hello';
import { points } from './fixtures/points';
import { readTally, saveSettings, tally } from './fixtures/reference';
import { trash } from './fixtures/trash';

const REPO = fileURLToPath(new URL('../../', import.meta.url));
const GUIDES = ['docs/plugins/writing-a-plugin.md', 'docs/plugins/api.md'];

let stdout: string[];
let stderr: string[];

beforeEach(() => {
  stdout = [];
  stderr = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    stdout.push(String(chunk));
    return true;
  });
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    stderr.push(String(chunk));
    return true;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = undefined;
});

/** Runs the CLI in this process over `root` with `registry`; returns the exit code and stdout. */
async function rowbly(root: string, registry: Parameters<typeof main>[1], ...args: string[]) {
  stdout.length = 0;
  stderr.length = 0;
  const code = await main(['--root', root, ...args], registry);
  return { code, out: stdout.join(''), err: stderr.join('') };
}

/**
 * The `// #region` blocks of the fixtures, as a Built-in Plugin in `src/plugins/<id>/` would write
 * them: imports from `../../plugin-api`, and without `biome-ignore` comments.
 */
async function regions(): Promise<Map<string, string>> {
  const dir = join(REPO, 'test/docs');
  const files = (await readdir(dir, { recursive: true })).filter((f) => /\.tsx?$/.test(f));
  const found = new Map<string, string>();
  for (const file of files) {
    const lines = (await readFile(join(dir, file), 'utf8')).split('\n');
    let name: string | undefined;
    let body: string[] = [];
    for (const line of lines) {
      const start = /^\s*\/\/ #region (\S+)$/.exec(line);
      if (start) {
        name = `${file}#${start[1]}`;
        body = [];
      } else if (/^\s*\/\/ #endregion$/.test(line) && name) {
        found.set(name, dedent(body).replace(/'(\.\.\/)+src\/plugin-api/g, "'../../plugin-api"));
        name = undefined;
      } else if (name && !/^\s*\/\/ biome-ignore/.test(line)) {
        body.push(line);
      }
    }
  }
  return found;
}

function dedent(lines: string[]): string {
  const indent = Math.min(...lines.filter((l) => l.trim()).map((l) => /^ */.exec(l)?.[0].length ?? 0));
  return lines.map((l) => l.slice(indent)).join('\n');
}

/** The ```ts and ```tsx blocks of a guide. */
function codeBlocks(markdown: string): string[] {
  return [...markdown.matchAll(/^```tsx?\n([\s\S]*?)^```$/gm)].map((m) => (m[1] ?? '').replace(/\n$/, ''));
}

describe('the guides show only compiled examples', () => {
  it('every TypeScript block in the guides is a fixture region, and every region is shown', async () => {
    const known = await regions();
    const shown = new Set<string>();
    const unknown: string[] = [];
    for (const guide of GUIDES) {
      for (const block of codeBlocks(await readFile(join(REPO, guide), 'utf8'))) {
        const name = [...known].find(([, text]) => text === block)?.[0];
        if (name) shown.add(name);
        else unknown.push(`${guide}:\n${block}`);
      }
    }
    expect(unknown).toEqual([]);
    expect([...known.keys()].filter((name) => !shown.has(name))).toEqual([]);
  });
});

describe('step 2: hello world', () => {
  it('shows its row in `stories show` and on the TUI Story screen', async () => {
    const t = await pluginRoot({ hello: true });
    await makeStory(t.path, { boardId: 'web', key: 'WEB-1', name: 'Login' });
    const { code, out } = await rowbly(t.path, [hello], 'stories', 'show', 'WEB-1');
    expect(code).toBe(0);
    expect(out).toMatch(/Hello\s*:?\s*WEB-1/);

    const { app } = await openPluginApp(t, [hello], { screen: 'story', params: { key: 'WEB-1' } });
    await waitForFrame(app, /Hello.*WEB-1/);
    app.unmount();
  });

  it('does nothing while it is off', async () => {
    const t = await pluginRoot();
    await makeStory(t.path, { boardId: 'web', key: 'WEB-1' });
    const { out } = await rowbly(t.path, [hello], 'stories', 'show', 'WEB-1');
    expect(out).not.toContain('Hello');
  });
});

describe('step 4: an editable field', () => {
  // #region test
  it('sets, keeps and clears points, and keeps zero', async () => {
    const host = await createPluginTestHost({ plugins: [points] });
    try {
      const { services } = host;
      const story = await services.stories.create('web', { name: 'Login', plugins: { points: { points: 0 } } });
      expect(story.plugins).toEqual({ points: { points: 0 } });

      // No input for the Plugin: its bag is kept.
      const renamed = await services.stories.update(story.key, { name: 'Sign in' });
      expect(renamed.plugins).toEqual({ points: { points: 0 } });

      // `null` is the explicit clear.
      const cleared = await services.stories.update(story.key, { plugins: { points: { points: null } } });
      expect(cleared.plugins).toBeUndefined();
    } finally {
      await host.dispose();
    }
  });

  it('rejects malformed input before anything is saved', async () => {
    const host = await createPluginTestHost({ plugins: [points] });
    try {
      const create = host.services.stories.create('web', { name: 'A', plugins: { points: { points: -1 } } });
      await expect(create).rejects.toMatchObject({ code: 'VALIDATION', details: { plugin: 'points' } });
      expect(await host.services.stories.list('web', {})).toEqual([]);
      expect(validatePluginDefinition(points)).toEqual([]);
    } finally {
      await host.dispose();
    }
  });
  // #endregion

  it('works from the command line: create, filter, show and clear', async () => {
    const t = await pluginRoot({ points: true });
    const run = (...args: string[]) => rowbly(t.path, [points], ...args);
    expect((await run('stories', 'create', '--board', 'web', '--name', 'A', '--points', '0')).code).toBe(0);
    expect((await run('stories', 'create', '--board', 'web', '--name', 'B', '--points', '3')).code).toBe(0);
    expect((await run('stories', 'create', '--board', 'web', '--name', 'C')).code).toBe(0);
    expect((await readJsonFile(t, storyFile('WEB-1'))).plugins).toEqual({ points: { points: 0 } });
    expect((await readJsonFile(t, storyFile('WEB-3'))).plugins).toBeUndefined();

    const listed = await run('--json', 'stories', 'list', '--board', 'web', '--points', '0');
    expect(JSON.parse(listed.out).map((s: { key: string }) => s.key)).toEqual(['WEB-1']);
    expect((await run('stories', 'show', 'WEB-2')).out).toMatch(/Points\s*:?\s*3/);

    expect((await run('stories', 'edit', 'WEB-2', '--no-points')).code).toBe(0);
    expect((await readJsonFile(t, storyFile('WEB-2'))).plugins).toBeUndefined();

    const bad = await run('--json', 'stories', 'edit', 'WEB-1', '--points', 'many');
    expect(bad.code).toBe(2);
    expect(JSON.parse(bad.err.trim().split('\n').at(-1) ?? '').error).toMatchObject({
      code: 'VALIDATION',
      details: { plugin: 'points', operation: 'stories.update' },
    });
    expect((await readJsonFile(t, storyFile('WEB-1'))).plugins).toEqual({ points: { points: 0 } });
  });
});

describe('step 5: commands', () => {
  it('`points total` adds up a Board', async () => {
    const t = await pluginRoot({ points: true });
    await makeStory(t.path, { boardId: 'web', key: 'WEB-1', plugins: { points: { points: 2 } } });
    await makeStory(t.path, { boardId: 'web', key: 'WEB-2', rank: 'a1', plugins: { points: { points: 3 } } });
    await makeStory(t.path, { boardId: 'web', key: 'WEB-3', rank: 'a2' });
    const { code, out } = await rowbly(t.path, [points], '--json', 'points', 'total', '--board', 'web');
    expect(code).toBe(0);
    expect(JSON.parse(out)).toEqual({
      board: 'web',
      stories: [
        { key: 'WEB-1', points: 2 },
        { key: 'WEB-2', points: 3 },
      ],
      total: 5,
    });
  });
});

describe('steps 6 and 7: the TUI', () => {
  it('a home menu entry opens the Points screen, which lists Stories with points', async () => {
    const t = await pluginRoot({ points: { label: 'Estimate' } });
    await makeStory(t.path, { boardId: 'web', key: 'WEB-1', name: 'Login', plugins: { points: { points: 0 } } });
    await makeStory(t.path, { boardId: 'web', key: 'WEB-2', name: 'Signup', rank: 'a1' });
    // With two Boards and none chosen, the TUI opens on the home menu.
    await makeBoard(t.path, { id: 'api', keyPrefix: 'API' });
    const { app } = await openPluginApp(t, [points], { screen: 'home', params: {} });
    await waitForFrame(app, 'Points');
    await focusListItem(app, 'Points');
    await app.press(KEYS.enter);
    const frame = await waitForFrame(app, 'Estimate by Story');
    expect(frame).toContain('WEB-1 · Login');
    expect(frame).not.toContain('WEB-2');
    app.unmount();
  });
});

describe('step 8: a guard', () => {
  it('refuses points above the Board setting `max`, and saves nothing', async () => {
    const t = await pluginRoot({ points: true });
    const config = await readJsonFile(t, 'boards/web/board.config.json');
    await writeFile(
      join(t.path, 'boards/web/board.config.json'),
      `${JSON.stringify({ ...config, plugins: { points: { max: 5 } } }, null, 2)}\n`,
    );
    const { code, err } = await rowbly(
      t.path,
      [points],
      '--json',
      'stories',
      'create',
      '--board',
      'web',
      '--name',
      'A',
      '--points',
      '8',
    );
    expect(code).toBe(4);
    expect(JSON.parse(err.trim().split('\n').at(-1) ?? '').error).toMatchObject({
      code: 'CONFLICT',
      details: { plugin: 'points', stage: 'guard', operation: 'stories.create' },
    });
    expect((await rowbly(t.path, [points], '--json', 'stories', 'list', '--board', 'web')).out.trim()).toBe('[]');
  });
});

describe('step 9: files, doctor and settings', () => {
  it('`points note` writes a Story file through its own operation', async () => {
    const t = await pluginRoot({ points: true });
    await makeStory(t.path, { boardId: 'web', key: 'WEB-1' });
    expect((await rowbly(t.path, [points], 'points', 'note', 'web-1', '--text', 'Two screens.')).code).toBe(0);
    expect(await readFile(join(t.path, 'boards/web/stories/WEB-1/plugins/points/estimate.md'), 'utf8')).toBe(
      'Two screens.',
    );
    expect((await rowbly(t.path, [points], 'points', 'note', 'WEB-1')).out).toContain('Two screens.');
  });

  it('doctor reports points above `max`, and --fix lowers them', async () => {
    const t = await pluginRoot({ points: { max: 5 } });
    await makeStory(t.path, { boardId: 'web', key: 'WEB-1', plugins: { points: { points: 8 } } });
    const check = await rowbly(t.path, [points], '--json', 'doctor');
    expect(JSON.parse(check.out).findings).toContainEqual(
      expect.objectContaining({ code: 'POINTS_ABOVE_MAX', severity: 'warning', details: { plugin: 'points' } }),
    );
    expect((await rowbly(t.path, [points], 'doctor', '--fix')).code).toBe(0);
    expect((await readJsonFile(t, storyFile('WEB-1'))).plugins).toEqual({ points: { points: 5 } });
  });

  it('a typo in the strict settings fails the load and keeps the data', async () => {
    const t = await pluginRoot({ points: { maximum: 5 } });
    await makeStory(t.path, { boardId: 'web', key: 'WEB-1', plugins: { points: { points: 8 } } });
    const { out } = await rowbly(t.path, [points], '--json', 'plugins', 'list');
    expect(JSON.parse(out)).toContainEqual(expect.objectContaining({ id: 'points', enabled: true, loaded: false }));
    expect((await readJsonFile(t, storyFile('WEB-1'))).plugins).toEqual({ points: { points: 8 } });
  });
});

describe('step 11 and the reference', () => {
  it('a replacement saves its file and the core deletion in one Change Set', async () => {
    const t = await pluginRoot({ trash: true });
    await makeStory(t.path, { boardId: 'web', key: 'WEB-1', name: 'Login' });
    const { services } = await withPlugins(t, [trash]);
    await services.stories.remove('WEB-1');
    await expect(services.stories.get('WEB-1')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const copy = JSON.parse(await readFile(join(t.path, 'boards/web/plugins/trash/WEB-1.json'), 'utf8'));
    expect(copy).toMatchObject({ key: 'WEB-1', name: 'Login' });
  });

  it('the reference examples load and behave as documented', async () => {
    const t = await pluginRoot({ tally: { count: 1 } });
    const { host, services } = await withPlugins(t, [tally]);
    expect(host.failures()).toEqual([]);
    const plugin = services.plugins.context('tally');

    await saveSettings(plugin, { count: 2 });
    expect((await readJsonFile(t, 'rowbly.config.json')).plugins).toEqual({ tally: { count: 2, enabled: true } });

    expect(await readTally(plugin)).toBeUndefined();
    await mkdir(join(t.path, 'plugins/tally'), { recursive: true });
    await writeFile(join(t.path, 'plugins/tally/tally.json'), '{"version":1,"count":-1}');
    await expect(readTally(plugin)).rejects.toMatchObject({ code: 'DATA_INTEGRITY' });
    await writeFile(join(t.path, 'plugins/tally/tally.json'), '{"version":1,"count":4}');
    expect(await readTally(plugin)).toEqual({ version: 1, count: 4 });
  });
});
