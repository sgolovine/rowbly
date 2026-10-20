import type { MarkedExtension } from 'marked';
import { markdownToPlain } from './DetailView';

/** Lays out markdown for the terminal: the rows it takes at `width`. */
export type MarkdownRenderer = (text: string, width: number) => string[];

let loaded: MarkdownRenderer | undefined;
let loading: Promise<MarkdownRenderer> | undefined;

/**
 * Markdown rendered for the terminal: headings, emphasis, lists, code and tables styled as
 * `marked-terminal` does (the renderer `ink-markdown` wraps). Rows wider than the width, such as
 * code and tables, wrap. Colors follow the terminal, so piped output is plain. The renderer loads on
 * first use rather than with the TUI, because its code highlighting takes a moment to load.
 */
export function loadMarkdownRenderer(): Promise<MarkdownRenderer> {
  loading ??= Promise.all([import('marked'), import('marked-terminal'), import('wrap-ansi')]).then(
    ([{ Marked }, { markedTerminal }, { default: wrapAnsi }]) => {
      // One Marked per width, so rendering never touches Marked's global options.
      const renderers = new Map<number, InstanceType<typeof Marked>>();
      const renderer = (width: number) => {
        let marked = renderers.get(width);
        if (!marked) {
          // `@types/marked-terminal` types the extension as a renderer class; at run time it is an extension.
          marked = new Marked(markedTerminal({ width, reflowText: true, tab: 2 }) as unknown as MarkedExtension, {
            renderer: {
              // `marked-terminal` prints a tight list item's text raw; render its inline markdown instead.
              text(token) {
                return 'tokens' in token && token.tokens ? this.parser.parseInline(token.tokens) : false;
              },
            },
          });
          renderers.set(width, marked);
        }
        return marked;
      };
      loaded = (text, width) => {
        const w = Math.max(1, width);
        const rendered = renderer(w)
          .parse(text, { async: false })
          // A full reset would also clear the background of the modal the text is shown in.
          .replaceAll('\u001b[0m', '')
          .replace(/\s+$/, '');
        return rendered.split('\n').flatMap((line) => wrapAnsi(line, w, { hard: true, trim: false }).split('\n'));
      };
      return loaded;
    },
  );
  return loading;
}

/** The markdown renderer once it has loaded; until then `undefined`. */
export function markdownRenderer(): MarkdownRenderer | undefined {
  return loaded;
}

/** The text without markdown syntax, in rows of at most `width` characters: shown until the renderer loads. */
export function plainMarkdownRows(text: string, width: number): string[] {
  const w = Math.max(1, width);
  return markdownToPlain(text.replace(/\s+$/, ''))
    .split('\n')
    .flatMap((line) => {
      const chars = Array.from(line);
      const rows: string[] = [];
      for (let i = 0; i < chars.length; i += w) rows.push(chars.slice(i, i + w).join(''));
      return rows.length ? rows : [''];
    });
}
