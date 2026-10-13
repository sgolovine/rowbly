import { readdir, readFile } from 'node:fs/promises';
import { builtinModules } from 'node:module';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('../src', import.meta.url));
const FIXTURES = fileURLToPath(new URL('./plugins/fixtures', import.meta.url));

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

/** A file's path below src/, `/`-separated. */
function srcPath(file: string): string {
  return relative(SRC, file).split(sep).join('/');
}

/**
 * The layer of a file under src/: its top-level folder, or file name for `cli.ts` and `main.ts`.
 * `plugin-api/tui.ts` is a layer of its own, because only it may import the TUI.
 */
function layerOf(file: string): string {
  const path = srcPath(file);
  if (path === 'plugin-api/tui.ts') return 'plugin-api-tui';
  const [first = ''] = path.split('/');
  return first.replace(/\.tsx?$/, '');
}

/** The Plugin a file belongs to (`src/plugins/<id>/…`), or `null` for core and the registry. */
function pluginOf(file: string): string | null {
  const parts = srcPath(file).split('/');
  return parts[0] === 'plugins' && parts.length > 2 ? (parts[1] ?? null) : null;
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
  'plugin-api': ['core', 'schemas', 'services', 'output', 'plugin-api'],
  'plugin-api-tui': ['tui', 'plugin-api-tui'],
  plugins: ['plugin-api', 'plugin-api-tui', 'plugins'],
  main: ['core', 'storage', 'services', 'commands', 'output', 'tui'],
  cli: ['main', 'plugins'],
};

const NODE_BUILTINS = new Set(builtinModules.flatMap((name) => [name, `node:${name}`]));

describe('architecture', async () => {
  const files = await sourceFiles(SRC);

  it('imports node:fs only inside src/storage/', async () => {
    const offenders: string[] = [];
    for (const file of files) {
      if (layerOf(file) === 'storage') continue;
      const source = await readFile(file, 'utf8');
      for (const spec of specifiers(source)) {
        if (/^(node:)?fs(\/|$)/.test(spec)) offenders.push(`${srcPath(file)} imports ${spec}`);
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
        offenders.push(`${srcPath(file)} is not in a known layer`);
        continue;
      }
      const source = await readFile(file, 'utf8');
      for (const spec of specifiers(source)) {
        if (!spec.startsWith('.')) continue;
        const target = layerOf(join(file, '..', spec));
        if (target !== '..' && !allowed.includes(target)) offenders.push(`${srcPath(file)} imports ${spec}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  // ADR-0009: a Plugin imports only the Plugin API (and its own files), and uses no Node built-ins
  // or packages of its own; everything else reaches it through Plugin API capabilities.
  it('a Plugin imports only the Plugin API and its own files', async () => {
    const offenders: string[] = [];
    for (const file of files) {
      const plugin = pluginOf(file);
      if (plugin === null) continue;
      for (const spec of specifiers(await readFile(file, 'utf8'))) {
        if (!spec.startsWith('.')) {
          const why = NODE_BUILTINS.has(spec) ? 'a Node built-in' : 'a package';
          offenders.push(`${srcPath(file)} imports ${why}: ${spec}`);
          continue;
        }
        const target = srcPath(join(file, '..', spec));
        const api = target === 'plugin-api' || target.startsWith('plugin-api/');
        const own = target === `plugins/${plugin}` || target.startsWith(`plugins/${plugin}/`);
        if (!api && !own) {
          offenders.push(`${srcPath(file)} imports ${spec}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  // The fixture Plugins stand in for Built-in Plugins in the tests, so they follow the same rule.
  it('the fixture Plugins import only the Plugin API and each other', async () => {
    const offenders: string[] = [];
    for (const file of await sourceFiles(FIXTURES)) {
      if (file.endsWith(`${sep}cli.ts`)) continue;
      for (const spec of specifiers(await readFile(file, 'utf8'))) {
        const target = spec.startsWith('.') ? join(file, '..', spec) : '';
        const api = target === join(SRC, 'plugin-api') || target.startsWith(join(SRC, 'plugin-api', sep));
        if (!api && !target.startsWith(FIXTURES)) offenders.push(`${relative(FIXTURES, file)} imports ${spec}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('core never imports a Plugin, and only the entry point reads the registry', async () => {
    const offenders: string[] = [];
    for (const file of files) {
      const path = srcPath(file);
      if (path === 'cli.ts' || path.startsWith('plugins/')) continue;
      for (const spec of specifiers(await readFile(file, 'utf8'))) {
        if (!spec.startsWith('.')) continue;
        const target = srcPath(join(file, '..', spec));
        if (target === 'plugins' || target.startsWith('plugins/')) offenders.push(`${path} imports ${spec}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the checks above see the rules being broken', () => {
    const plugin = join(SRC, 'plugins', 'demo', 'index.ts');
    expect(pluginOf(plugin)).toBe('demo');
    expect(pluginOf(join(SRC, 'plugins', 'index.ts'))).toBeNull();
    expect(layerOf(join(SRC, 'plugin-api', 'tui.ts'))).toBe('plugin-api-tui');
    expect(NODE_BUILTINS.has('node:fs')).toBe(true);
    expect(NODE_BUILTINS.has('child_process')).toBe(true);
    expect(specifiers("import { x } from '../../services';\nconst m = await import('./tui');")).toEqual([
      '../../services',
      './tui',
    ]);
  });
});
