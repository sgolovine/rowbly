import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { builtInPlugins } from '../../src/plugins';
import { userText } from './sourceText';

/**
 * `_Avoid_` words from docs/agents/CONTEXT.md that must never reach a user. Words that are also ordinary English
 * in another sense (`order`, `position`, `category`, `note`) are left out.
 */
const AVOID =
  /\b(issues?|tickets?|sub-?tasks?|columns?|cards?|lanes?|status(es)?|states?|story (id|slug)s?|checklist items?|tags?|projects?|workspaces?|users?|owners?|members?|propert(y|ies)|attributes?|metadata|sessions?|profiles?|databases?|initiatives?|importance|inheritance|overrides?)\b/i;

/** Legitimate uses, removed from the text before matching. */
const ALLOWED: { file?: RegExp; text: RegExp; why: string }[] = [
  { file: /^(tui|plugins)\//, text: /^column$/, why: 'Ink layout: flexDirection="column"' },
  { file: /^main\.ts$/, text: /^user$/, why: "commander: parseAsync(argv, { from: 'user' })" },
  { text: /\buser\.email\b/g, why: 'the git config key' },
  { text: /\bLocal State\b/g, why: 'a CONTEXT.md term' },
  { text: /^\.\.?\/.*$/, why: 'a relative import path' },
];

const SRC = fileURLToPath(new URL('../../src/', import.meta.url));

/**
 * The `_Avoid_` words of a glossary as one pattern, or `undefined` when it lists none: an empty
 * alternation would match everywhere (DX-05).
 */
function avoidPattern(context: string): RegExp | undefined {
  const avoid = [...context.matchAll(/^_Avoid_:\s*(.+)$/gm)].flatMap((m) => (m[1] ?? '').split(','));
  const escaped = avoid.map((w) => w.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).filter(Boolean);
  return escaped.length > 0 ? new RegExp(`\\b(${escaped.join('|')})\\b`, 'i') : undefined;
}

/** A Built-in Plugin's glossary, `src/plugins/<id>/CONTEXT.md`, or a precise error when it is missing. */
async function glossary(id: string): Promise<string> {
  try {
    return await readFile(`${SRC}plugins/${id}/CONTEXT.md`, 'utf8');
  } catch {
    throw new Error(
      `Built-in Plugin "${id}" has no src/plugins/${id}/CONTEXT.md; every Built-in Plugin needs a glossary (docs/plugins/writing-a-plugin.md)`,
    );
  }
}

/**
 * Each Built-in Plugin's `_Avoid_` words, from the CONTEXT.md in its folder (listed in docs/agents/CONTEXT-MAP.md).
 * They apply to the Plugin's own source and help pages; core never uses a Plugin's terms at all. Only Plugins in the
 * registry are read: a folder under src/plugins/ that holds no registered Plugin is not a Plugin and has no glossary.
 */
async function pluginAvoidWords(): Promise<Map<string, RegExp>> {
  const words = new Map<string, RegExp>();
  for (const { id } of builtInPlugins) {
    const pattern = avoidPattern(await glossary(id));
    if (pattern) words.set(id, pattern);
  }
  return words;
}

/** The text with its allowed uses blanked out. */
function strip(file: string, text: string): string {
  return ALLOWED.reduce(
    (rest, allowed) => (allowed.file && !allowed.file.test(file) ? rest : rest.replace(allowed.text, ' ')),
    text,
  );
}

describe('language audit', () => {
  it('no _Avoid_ word appears in a user-facing string, template or JSX text in src/', async () => {
    const files = (await readdir(SRC, { recursive: true })).filter((f) => /\.tsx?$/.test(f));
    const found: string[] = [];
    let texts = 0;
    for (const file of files) {
      for (const { line, text } of userText(await readFile(SRC + file, 'utf8'), file.endsWith('.tsx'))) {
        texts++;
        const match = strip(file, text).match(AVOID);
        if (match) found.push(`src/${file}:${line} "${match[0]}" in ${JSON.stringify(text)}`);
      }
    }
    // Guards the tokenizer: it must actually find the app's messages.
    expect(texts).toBeGreaterThan(1000);
    expect(found).toEqual([]);
  });

  it("no Plugin's _Avoid_ word appears in its own user-facing text", async () => {
    const plugins = await pluginAvoidWords();
    // Guards the parser: the Built-in Plugins' glossaries are there.
    expect(plugins.get('epics')?.test('an initiative')).toBe(true);
    expect(plugins.get('specs')?.test('the design doc')).toBe(true);
    const found: string[] = [];
    for (const [id, avoid] of plugins) {
      const files = (await readdir(`${SRC}plugins/${id}`, { recursive: true })).filter((f) => /\.tsx?$/.test(f));
      for (const file of files) {
        const source = await readFile(`${SRC}plugins/${id}/${file}`, 'utf8');
        for (const { line, text } of userText(source, file.endsWith('.tsx'))) {
          const match = text.match(avoid);
          if (match) found.push(`src/plugins/${id}/${file}:${line} "${match[0]}" in ${JSON.stringify(text)}`);
        }
      }
    }
    expect(found).toEqual([]);
  });

  it('every Built-in Plugin has a glossary with _Avoid_ words, linked from CONTEXT-MAP.md (DX-05)', async () => {
    const map = await readFile(`${SRC}../docs/agents/CONTEXT-MAP.md`, 'utf8');
    const problems: string[] = [];
    for (const { id } of builtInPlugins) {
      if (!avoidPattern(await glossary(id))) problems.push(`src/plugins/${id}/CONTEXT.md lists no _Avoid_ words`);
      if (!map.includes(`(../../src/plugins/${id}/CONTEXT.md)`)) {
        problems.push(`docs/agents/CONTEXT-MAP.md does not link src/plugins/${id}/CONTEXT.md`);
      }
    }
    expect(problems).toEqual([]);
  });
});
