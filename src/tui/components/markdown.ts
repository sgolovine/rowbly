import { Marked, type MarkedExtension } from 'marked';
import { markedTerminal } from 'marked-terminal';
import wrapAnsi from 'wrap-ansi';

/** One Marked per width, so rendering never touches Marked's global options. */
const renderers = new Map<number, Marked>();

function renderer(width: number): Marked {
  let marked = renderers.get(width);
  if (!marked) {
    // `@types/marked-terminal` types the extension as a renderer class; at run time it is an extension.
    marked = new Marked(markedTerminal({ width, reflowText: true, tab: 2 }) as unknown as MarkedExtension);
    renderers.set(width, marked);
  }
  return marked;
}

/**
 * Markdown rendered for the terminal, as the rows it takes at `width`: headings, emphasis, lists,
 * code and tables styled as `marked-terminal` does (the renderer `ink-markdown` wraps). Rows wider
 * than `width`, such as code and tables, wrap. Colors follow the terminal, so piped output is plain.
 */
export function renderMarkdown(text: string, width: number): string[] {
  const w = Math.max(1, width);
  const rendered = renderer(w)
    .parse(text, { async: false })
    // A full reset would also clear the background of the modal the text is shown in.
    .replaceAll('\u001b[0m', '')
    .replace(/\s+$/, '');
  return rendered.split('\n').flatMap((line) => wrapAnsi(line, w, { hard: true, trim: false }).split('\n'));
}
