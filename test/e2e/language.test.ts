import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { runCli } from '../helpers';
import { userText } from './sourceText';

/**
 * `_Avoid_` words from CONTEXT.md that must never reach a user. Words that are also ordinary English
 * in another sense (`order`, `position`, `category`, `note`) are left out.
 */
const AVOID =
  /\b(issues?|tickets?|sub-?tasks?|columns?|cards?|lanes?|status(es)?|states?|story (id|slug)s?|checklist items?|tags?|projects?|users?|owners?|members?|propert(y|ies)|attributes?|metadata|sessions?|profiles?|databases?|initiatives?|importance|inheritance|overrides?)\b/i;

/** Legitimate uses, removed from the text before matching. */
const ALLOWED: { file?: RegExp; text: RegExp; why: string }[] = [
  { file: /^tui\//, text: /^column$/, why: 'Ink layout: flexDirection="column"' },
  { file: /^cli\.ts$/, text: /^user$/, why: "commander: parseAsync(argv, { from: 'user' })" },
  { text: /\buser\.email\b/g, why: 'the git config key' },
  { text: /\bLocal State\b/g, why: 'a CONTEXT.md term' },
  { text: /^\.\.?\/.*$/, why: 'a relative import path' },
];

const SRC = fileURLToPath(new URL('../../src/', import.meta.url));

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

  it('the audit catches an _Avoid_ word in a string, a template and JSX text', () => {
    const source = [
      "const a = 'Open the ticket';",
      // biome-ignore lint/suspicious/noTemplateCurlyInString: this is source text for the tokenizer.
      'const b = `${n} sub-tasks`; // a column in a comment is fine',
      'const c = <Text>Move the card</Text>;',
      'const d = /issue/.test(x) ? 1 : 2;',
    ].join('\n');
    const hits = userText(source, true)
      .map(({ text }) => text.match(AVOID)?.[0])
      .filter(Boolean);
    expect(hits).toEqual(['ticket', 'sub-tasks', 'card']);
  });

  it('no _Avoid_ word appears in any --help text', async () => {
    const root = await runCli(['--help']);
    const groups = commandsIn(root.stdout);
    expect(groups).toContain('stories');
    const pages = [root];
    for (const group of groups) {
      const page = await runCli([group, '--help']);
      pages.push(page, ...(await Promise.all(commandsIn(page.stdout).map((verb) => runCli([group, verb, '--help'])))));
    }
    expect(pages.length).toBeGreaterThan(50);
    const found = pages.flatMap((page) =>
      page.stdout.split('\n').filter((line) => AVOID.test(line.replace(/\bLocal State\b|\buser\.email\b/g, ' '))),
    );
    expect(found).toEqual([]);
  });
});

/** The command names listed under "Commands:" in a commander help page. */
function commandsIn(help: string): string[] {
  const section = help.split(/^Commands:$/m)[1] ?? '';
  return [...section.matchAll(/^ {2}([a-z][a-z-]*)\b/gm)].map((m) => m[1] as string).filter((c) => c !== 'help');
}
