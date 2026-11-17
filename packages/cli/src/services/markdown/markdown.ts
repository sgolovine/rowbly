import matter from "gray-matter";
import { parse, stringify } from "yaml";
import { ValidationError } from "../errors/errors.js";

export interface MarkdownDocument {
  /** The YAML frontmatter, `{}` when there is none. */
  data: Record<string, unknown>;
  body: string;
}

/**
 * Parses and writes the frontmatter with `yaml` instead of gray-matter's bundled js-yaml. Passing options also
 * turns off gray-matter's cache, which would hand every caller the same mutable `data` object.
 */
const OPTIONS = {
  engines: {
    yaml: {
      parse: (text: string) => parse(text) ?? {},
      stringify: (data: object) => stringify(data, { lineWidth: 0 }),
    },
  },
};

/** Runs gray-matter, and turns a YAML syntax error into a `ValidationError` that names the file. */
function readFrontmatter(text: string, file: string): matter.GrayMatterFile<string> {
  try {
    return matter(text, OPTIONS);
  } catch (error) {
    const reason = ((error as Error).message.split("\n")[0] ?? "").replace(/:$/, "");

    throw new ValidationError(`${file} has invalid frontmatter: ${reason}`, {
      cause: error,
      details: { reason },
      hint: "Run `rowbly doctor` to find problems in Rowbly's files.",
    });
  }
}

/** Splits a Markdown file into its YAML frontmatter and its body. */
export function parseMarkdown(text: string, file: string): MarkdownDocument {
  const parsed = readFrontmatter(text, file);
  const data: unknown = parsed.data;

  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new ValidationError(`${file} frontmatter must be a set of key: value pairs`);
  }

  return { data: data as Record<string, unknown>, body: parsed.content.trim() };
}

/** Writes a Markdown file: the YAML frontmatter, when there is data, then the body. */
export function serializeMarkdown(doc: MarkdownDocument): string {
  const body = doc.body.trim();

  if (Object.keys(doc.data).length === 0) {
    return body ? `${body}\n` : "";
  }

  return matter.stringify(body ? `\n${body}` : "", doc.data, OPTIONS);
}
