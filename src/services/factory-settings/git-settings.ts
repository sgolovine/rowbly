import { ValidationError } from "../errors/errors.js";

/** The Git settings of the canonical commits that the factory makes. */
export interface GitSettings {
  readonly commitMessage?: string;
  readonly authorName?: string;
  readonly authorEmail?: string;
}

/** The Git values of `rowbly factory configure`. An empty string clears the value. */
export interface GitInput {
  readonly commitMessage?: string;
  readonly commitAuthor?: string;
}

type Author = Pick<GitSettings, "authorName" | "authorEmail">;

const GIT_KEYS: readonly (keyof GitSettings)[] = ["commitMessage", "authorName", "authorEmail"];
const IDENTITY = /^([^<>\n]*[^<>\s])\s*<([^<>\s]+)>$/;

function validText(value: unknown): boolean {
  return value === undefined || (typeof value === "string" && !!value.trim());
}

/** Tells if a value is a Git section with non-empty strings and with the author name and email together. */
export function validGit(value: unknown): value is GitSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const git = value as Record<string, unknown>;

  return (
    GIT_KEYS.every((key) => validText(git[key])) && (git.authorName === undefined) === (git.authorEmail === undefined)
  );
}

/** Parses a `Name <email>` identity. */
export function parseAuthor(value: string): Required<Author> {
  const match = IDENTITY.exec(value.trim());

  if (!match) {
    throw new ValidationError('Use "Name <email>" for the commit author');
  }

  return { authorName: (match[1] as string).trim(), authorEmail: match[2] as string };
}

/** Gives the `Name <email>` identity of the settings, or nothing without an author. */
export function formatAuthor(git: GitSettings | undefined): string | undefined {
  if (!git?.authorName || !git.authorEmail) {
    return undefined;
  }

  return `${git.authorName} <${git.authorEmail}>`;
}

function nextMessage(current: GitSettings | undefined, input: GitInput): string | undefined {
  if (input.commitMessage === undefined) {
    return current?.commitMessage;
  }

  return input.commitMessage.trim() ? input.commitMessage : undefined;
}

function nextAuthor(current: GitSettings | undefined, input: GitInput): Author {
  if (input.commitAuthor === undefined) {
    return { authorName: current?.authorName, authorEmail: current?.authorEmail };
  }

  return input.commitAuthor.trim() ? parseAuthor(input.commitAuthor) : {};
}

/** Applies the input to the Git section. Other keys stay. Without values, the section goes away. */
export function mergeGit(current: GitSettings | undefined, input: GitInput): GitSettings | undefined {
  const changed: GitSettings = { commitMessage: nextMessage(current, input), ...nextAuthor(current, input) };
  const others = Object.entries(current ?? {}).filter(([key]) => !GIT_KEYS.includes(key as keyof GitSettings));
  const values = Object.entries(changed).filter(([, value]) => value !== undefined);

  const entries = [...others, ...values];

  return entries.length > 0 ? (Object.fromEntries(entries) as GitSettings) : undefined;
}

/** Tells if the input changes the Git section. */
export function hasGitInput(input: GitInput): boolean {
  return input.commitMessage !== undefined || input.commitAuthor !== undefined;
}
