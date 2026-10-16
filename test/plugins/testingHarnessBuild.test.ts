// The built CLI never loads a testing library or the Plugin test harness (DX-15): checked on the
// emitted bundle and every chunk it can import, not on source imports.
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CLI_PATH } from '../helpers';

/** The packages and modules a production import must not reach. */
const TESTING = /^(vitest(\/|$)|@vitest\/|ink-testing-library(\/|$))/;

/** Every module specifier of an emitted ESM file: static imports, re-exports and dynamic imports. */
function specifiers(code: string): string[] {
  const patterns = [
    /\bfrom\s*["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']/g,
    /^\s*import\s*["']([^"']+)["']/gm,
  ];
  return patterns.flatMap((pattern) => [...code.matchAll(pattern)].map((m) => m[1] ?? ''));
}

describe('the built CLI', () => {
  it('imports no testing library and bundles no test harness', async () => {
    const dir = dirname(CLI_PATH);
    const files = (await readdir(dir)).filter((name) => name.endsWith('.js'));
    expect(files).toContain('cli.js');
    const offenders: string[] = [];
    for (const name of files) {
      const code = await readFile(join(dir, name), 'utf8');
      for (const spec of specifiers(code)) if (TESTING.test(spec)) offenders.push(`${name} imports ${spec}`);
      if (code.includes('createPluginTestHost')) offenders.push(`${name} contains the Plugin test harness`);
    }
    expect(offenders).toEqual([]);
  });

  it('the check sees a testing import', () => {
    expect(specifiers('import { render } from "ink-testing-library";').filter((s) => TESTING.test(s))).toHaveLength(1);
    expect(specifiers('await import("vitest")').filter((s) => TESTING.test(s))).toHaveLength(1);
    expect(specifiers('export * from "@vitest/expect";').filter((s) => TESTING.test(s))).toHaveLength(1);
    expect(specifiers('import "vitesse";').filter((s) => TESTING.test(s))).toHaveLength(0);
  });
});
