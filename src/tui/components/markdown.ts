import chalk from "chalk";
import type { MarkedExtension } from "marked";
import { Store, withEntry } from "../../services/store/store.js";
import { theme } from "../theme.js";
import { markdownToPlain } from "./detail-view/index.js";
import { plainRows } from "./text-rows.js";

/** Lays out markdown for the terminal: the rows it takes at `width`. */
export type MarkdownRenderer = (text: string, width: number) => string[];

type MarkedModule = typeof import("marked");
type Marked = InstanceType<MarkedModule["Marked"]>;

/** The modules that the renderer loads on first use. */
interface MarkdownModules {
  readonly Marked: MarkedModule["Marked"];
  readonly markedTerminal: typeof import("marked-terminal")["markedTerminal"];
  readonly wrapAnsi: typeof import("wrap-ansi")["default"];
}

/** The renderer of this process, once it loads, and one Marked for each width. */
interface MarkdownState {
  readonly loaded?: MarkdownRenderer;
  readonly loading?: Promise<MarkdownRenderer>;
  readonly byWidth: ReadonlyMap<number, Marked>;
}

const markdown = new Store<MarkdownState>({ byWidth: new Map() });

/**
 * Preserve semantic ink even when marked-terminal emits ANSI styles. Through chalk, as Ink colours
 * its own text, so the colour level is the one chalk detects for the terminal (`supports-color`:
 * `FORCE_COLOR`, `--color`/`--no-color`, a TTY and `TERM`).
 */
function tint(color: string): (text: string) => string {
  return (text) => chalk.hex(color)(text);
}

function strong(color: string): (text: string) => string {
  return (text) => chalk.bold(tint(color)(text));
}

/** A Marked for `width`. One Marked for each width, so rendering never touches Marked's global options. */
function createMarked({ Marked, markedTerminal }: MarkdownModules, width: number): Marked {
  return new Marked(
    // `@types/marked-terminal` types the extension as a renderer class; at run time it is an extension.
    markedTerminal({
      width,
      reflowText: true,
      tab: 2,
      heading: strong(theme.ink),
      firstHeading: strong(theme.ink),
      code: tint(theme.inkMuted),
      codespan: tint(theme.inkMuted),
      blockquote: tint(theme.inkMuted),
      html: tint(theme.inkMuted),
      link: tint(theme.accent),
      href: tint(theme.inkMuted),
      del: tint(theme.inkMuted),
    }) as unknown as MarkedExtension,
    {
      renderer: {
        // `marked-terminal` prints a tight list item's text raw; render its inline markdown instead.
        code(token) {
          return `\n${tint(theme.inkMuted)(token.text)}\n`;
        },
        text(token) {
          return "tokens" in token && token.tokens ? this.parser.parseInline(token.tokens) : false;
        },
      },
    },
  );
}

function markedFor(modules: MarkdownModules, width: number): Marked {
  const known = markdown.current.byWidth.get(width);
  const marked = known ?? createMarked(modules, width);

  if (!known) {
    markdown.update(({ byWidth }) => ({ byWidth: withEntry(byWidth, width, marked) }));
  }

  return marked;
}

function renderMarkdown(modules: MarkdownModules, text: string, width: number): string[] {
  const size = Math.max(1, width);
  const rendered = markedFor(modules, size)
    .parse(text, { async: false })
    // A full reset would also clear the background of the modal the text is shown in.
    .replaceAll("\u001b[0m", "")
    .replace(/\s+$/, "");

  return rendered.split("\n").flatMap((line) => modules.wrapAnsi(line, size, { hard: true, trim: false }).split("\n"));
}

function rendererOf(modules: MarkdownModules): MarkdownRenderer {
  return (text, width) => renderMarkdown(modules, text, width);
}

async function importRenderer(): Promise<MarkdownRenderer> {
  const [{ Marked }, { markedTerminal }, { default: wrapAnsi }] = await Promise.all([
    import("marked"),
    import("marked-terminal"),
    import("wrap-ansi"),
  ]);
  const loaded = rendererOf({ Marked, markedTerminal, wrapAnsi });

  markdown.update(() => ({ loaded }));

  return loaded;
}

/**
 * Markdown rendered for the terminal: headings, emphasis, lists, code and tables styled as
 * `marked-terminal` does (the renderer `ink-markdown` wraps). Rows wider than the width, such as
 * code and tables, wrap. Colors follow the terminal, so piped output is plain. The renderer loads on
 * first use rather than with the TUI, because its code highlighting takes a moment to load.
 */
export function loadMarkdownRenderer(): Promise<MarkdownRenderer> {
  const loading = markdown.current.loading ?? importRenderer();

  markdown.update(() => ({ loading }));

  return loading;
}

/** The markdown renderer once it has loaded; until then `undefined`. */
export function markdownRenderer(): MarkdownRenderer | undefined {
  return markdown.current.loaded;
}

/** The text without markdown syntax, in rows of at most `width` characters: shown until the renderer loads. */
export function plainMarkdownRows(text: string, width: number): string[] {
  return plainRows(markdownToPlain(text.replace(/\s+$/, "")), width);
}
