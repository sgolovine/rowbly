/**
 * The text a user can see in a TypeScript/TSX source file: string literals, template-literal text
 * and JSX text, each with its line number. Comments and code are skipped. This is a small tokenizer
 * for the language audit, not a full parser; it relies on the code being formatted by Biome.
 */
export function userText(source: string, jsx: boolean): { line: number; text: string }[] {
  const out: { line: number; text: string }[] = [];
  const lineAt = (index: number) => source.slice(0, index).split('\n').length;
  let i = 0;

  /** Whether a `/` at `i` starts a regex literal rather than a division or a JSX closing tag. */
  const regexAllowed = () => {
    let j = i - 1;
    while (j >= 0 && /\s/.test(source[j] as string)) j--;
    if (j < 0) return true;
    if ('(,=:[!&|?{;+-*%~^'.includes(source[j] as string)) return true;
    return /\b(return|typeof|case|in|of|new|delete|void|throw)$/.test(source.slice(Math.max(0, j - 6), j + 1));
  };

  /** Reads a quoted string or a template literal starting at `i` (template expressions are code). */
  const readString = (quote: string) => {
    const start = i++;
    let text = '';
    while (i < source.length && source[i] !== quote) {
      if (source[i] === '\\') {
        text += source.slice(i, i + 2);
        i += 2;
      } else if (quote === '`' && source.startsWith('${', i)) {
        i += 2;
        readCode('}');
        i++;
        text += ' ';
      } else text += source[i++];
    }
    i++;
    out.push({ line: lineAt(start), text });
  };

  /** Skips code until an unmatched `close` (or the end), collecting the strings inside it. */
  const readCode = (close?: string) => {
    let depth = 0;
    while (i < source.length) {
      const c = source[i] as string;
      if (close && c === close && depth === 0) return;
      if (c === '{') depth++;
      else if (c === '}') depth--;
      if (source.startsWith('//', i)) i = source.indexOf('\n', i) === -1 ? source.length : source.indexOf('\n', i);
      else if (source.startsWith('/*', i)) i = source.indexOf('*/', i) + 2;
      else if (c === "'" || c === '"' || c === '`') readString(c);
      else if (c === '/' && regexAllowed()) {
        i++;
        let inClass = false;
        while (i < source.length && (source[i] !== '/' || inClass)) {
          if (source[i] === '\\') i++;
          else if (source[i] === '[') inClass = true;
          else if (source[i] === ']') inClass = false;
          i++;
        }
        i++;
      } else if (jsx && c === '>' && /^[^<>{}=;()&|]*[A-Za-z][^<>{}=;()&|]*</.test(source.slice(i + 1, i + 400))) {
        // JSX text: everything up to the next tag or expression.
        const end = source.slice(i + 1).search(/[<{]/);
        out.push({ line: lineAt(i + 1), text: source.slice(i + 1, i + 1 + end) });
        i += 1 + end;
      } else i++;
    }
  };

  readCode();
  return out;
}
