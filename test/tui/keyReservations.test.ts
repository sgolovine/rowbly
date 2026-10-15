// Every single-character key that core handles is reserved in `CORE_KEYS`, so that no Plugin Action
// can take it (ARCH-13). The keys are read from the TUI source: input comparisons, key hints and
// `case` labels, plus the helper tables that match keys without a literal comparison.
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Key } from 'ink';
import { describe, expect, it } from 'vitest';
import { CORE_KEYS, globalAction, moveDelta } from '../../src/tui/keymap';
import { boardKey } from '../../src/tui/shell/boardKey';

const TUI = join(import.meta.dirname, '../../src/tui');

async function sources(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true });
  return entries
    .filter((e) => e.isFile() && /\.tsx?$/.test(e.name))
    .map((e) => join(e.parentPath, e.name))
    .sort();
}

const QUOTED = `(['"\`])(.)\\1`;
const PATTERNS = [
  // `input === 'x'` and `'x' !== input`.
  new RegExp(`\\binput\\s*[!=]==?\\s*${QUOTED}`, 'g'),
  new RegExp(`${QUOTED}\\s*[!=]==?\\s*input\\b`, 'g'),
  // A key hint `{ key: 'x', … }`.
  new RegExp(`\\bkey:\\s*${QUOTED}`, 'g'),
  // `case 'x':` in a switch on the input.
  new RegExp(`\\bcase\\s+${QUOTED}\\s*:`, 'g'),
];

/** The single-character keys that `source` compares the input with or shows as hints. */
function keysIn(source: string): string[] {
  return PATTERNS.flatMap((pattern) => [...source.matchAll(pattern)].map((match) => match[2] as string));
}

/** No modifier and no special key: what Ink passes along with a plain character. */
const PLAIN = {} as Key;

/** Every printable ASCII character. */
const PRINTABLE = Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i));

describe('core key reservations (ARCH-13)', () => {
  it('finds a key that core starts to handle', () => {
    expect(keysIn(`if (input === 'X') go(); else if ('Y' == input) stay();`)).toEqual(['X', 'Y']);
    expect(keysIn(`useKeyHints([{ key: 'W', description: 'w' }, { key: 'tab/←/→', description: 'switch' }]);`)).toEqual(
      ['W'],
    );
    expect(keysIn(`switch (input) { case 'V': break; }`)).toEqual(['V']);
  });

  it('reserves every single-character key in the TUI source', async () => {
    const found = new Map<string, string>();
    for (const file of await sources(TUI)) {
      for (const key of keysIn(await readFile(file, 'utf8'))) if (!found.has(key)) found.set(key, file);
    }
    // The scan sees the keys it should, so a broken pattern cannot pass silently.
    expect([...found.keys()]).toEqual(expect.arrayContaining(['?', 'q', 'e', 'd', 'y', 'n', '/', ' ']));
    const missing = [...found].filter(([key]) => !CORE_KEYS.includes(key)).map(([key, file]) => `"${key}" (${file})`);
    expect(missing).toEqual([]);
  });

  it('reserves the keys the helper tables match', () => {
    const matched = PRINTABLE.filter(
      (c) => boardKey(c, 0, 9) !== null || moveDelta(c, PLAIN) !== 0 || globalAction(c, PLAIN) !== null,
    );
    expect(matched).toEqual(expect.arrayContaining(['[', ']', '1', '9', 'j', 'k', 'q', '?', ',']));
    expect(matched.filter((c) => !CORE_KEYS.includes(c))).toEqual([]);
  });
});
