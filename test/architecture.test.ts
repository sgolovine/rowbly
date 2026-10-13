import { readdir, readFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('../src', import.meta.url));

async function sourceFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return sourceFiles(path);
      return /\.tsx?$/.test(entry.name) ? [path] : [];
    }),
  );
  return nested.flat();
}

/** Every module specifier in static imports/exports, dynamic imports and requires. */
function specifiers(source: string): string[] {
  const found: string[] = [];
  const patterns = [
    /\bfrom\s+['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]/g,
    /\brequire\s*\(\s*['"]([^'"]+)['"]/g,
    /^\s*import\s+['"]([^'"]+)['"]/gm,
  ];
  for (const pattern of patterns) for (const match of source.matchAll(pattern)) if (match[1]) found.push(match[1]);
  return found;
}

/** The top-level layer of a file under src/ (`cli` for src/cli.ts). */
function layerOf(file: string): string {
  const [first = ''] = relative(SRC, file).split(sep);
  return first.replace(/\.tsx?$/, '');
}

/** README §3: each layer may import only from the layers listed (always including itself). */
const ALLOWED: Record<string, string[]> = {
  core: ['core'],
  schemas: ['core', 'schemas'],
  storage: ['core', 'schemas', 'storage'],
  services: ['core', 'schemas', 'storage', 'services'],
  output: ['core', 'schemas', 'services', 'output'],
  commands: ['core', 'schemas', 'storage', 'services', 'output', 'commands'],
  tui: ['core', 'schemas', 'storage', 'services', 'output', 'tui'],
  cli: ['core', 'commands', 'output', 'tui'],
};

describe('architecture', async () => {
  const files = await sourceFiles(SRC);

  it('imports node:fs only inside src/storage/', async () => {
    const offenders: string[] = [];
    for (const file of files) {
      if (layerOf(file) === 'storage') continue;
      const source = await readFile(file, 'utf8');
      for (const spec of specifiers(source)) {
        if (/^(node:)?fs(\/|$)/.test(spec)) offenders.push(`${relative(SRC, file)} imports ${spec}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('only imports downward between layers', async () => {
    const offenders: string[] = [];
    for (const file of files) {
      const layer = layerOf(file);
      const allowed = ALLOWED[layer];
      if (!allowed) {
        offenders.push(`${relative(SRC, file)} is not in a known layer`);
        continue;
      }
      const source = await readFile(file, 'utf8');
      for (const spec of specifiers(source)) {
        if (!spec.startsWith('.')) continue;
        const target = layerOf(join(file, '..', spec));
        if (target !== '..' && !allowed.includes(target)) offenders.push(`${relative(SRC, file)} imports ${spec}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
