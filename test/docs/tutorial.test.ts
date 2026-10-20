// The Plugin author guide's examples (DX-03, DX-05, DOC-03): each TypeScript example in
// docs/plugins/writing-a-plugin.md and docs/plugins/api.md is a region of a fixture under test/docs/fixtures/,
// which `pnpm typecheck` compiles, so the guide cannot drift from the API. The test example of step 10 runs here.
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createPluginTestHost, validatePluginDefinition } from '../../src/plugin-api/testing';
import { points } from './fixtures/points';

const REPO = fileURLToPath(new URL('../../', import.meta.url));
const GUIDES = ['docs/plugins/writing-a-plugin.md', 'docs/plugins/api.md'];

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
});
