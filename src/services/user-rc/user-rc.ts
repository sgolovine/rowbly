import { readFile, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { ValidationError } from "../errors/errors.js";
import { writeFileAtomic } from "../files/files.js";
import type { ServiceContext } from "../workspace/workspace.js";

/** The per-user file, in the home directory, that holds the projects and the worker hosts of the user. */
export const RC_FILE = ".rowblyrc.json";

/** The parsed file. A write keeps all keys, also the keys that Rowbly does not know. */
export type UserRc = Readonly<Record<string, unknown>>;

interface WriteRcOptions {
  /** The file mode of a new file. */
  readonly mode?: number;
}

/** The error for a file that Rowbly cannot read. Rowbly must not write such a file. */
export function invalidRc(file: string, cause?: unknown): ValidationError {
  return new ValidationError(`${file} is invalid`, { hint: "Fix the file by hand.", cause });
}

/** The path of the file in the home directory of `ctx`. */
export function rcPath(ctx: ServiceContext): string {
  return join(ctx.home ?? homedir(), RC_FILE);
}

/** The text of the file, or `undefined` when nothing is at `file`. */
async function readRcText(file: string): Promise<string | undefined> {
  try {
    return await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }

    throw error;
  }
}

function parseRc(text: string, file: string): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw invalidRc(file, error);
  }
}

/** The whole file. Nothing at `file` is an empty file. Invalid JSON or a value that is not an object throws. */
export async function readRc(file: string): Promise<UserRc> {
  const text = await readRcText(file);

  if (text === undefined) {
    return {};
  }

  const rc = parseRc(text, file);

  if (typeof rc !== "object" || rc === null || Array.isArray(rc)) {
    throw invalidRc(file);
  }

  return rc as UserRc;
}

/** Writes the whole file atomically. */
export async function writeRc(file: string, rc: UserRc, options: WriteRcOptions = {}): Promise<void> {
  // A dotfile manager often makes this file a link: write through the link and keep it.
  const target = await realpath(file).catch(() => file);

  await writeFileAtomic(target, `${JSON.stringify(rc, null, 2)}\n`, options);
}
