import { readFile, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { ValidationError } from "../errors/errors.js";
import { pathExists, writeFileAtomic } from "../files/files.js";
import { projectPaths, type ServiceContext } from "../workspace/workspace.js";

/** The per-user file, in the home directory, that lists the projects the user has opened. */
export const RC_FILE = ".rowblyrc.json";

export interface KnownProject {
  /** The directory that contains `.rowbly/`. */
  path: string;
  name: string;
  /** The project is no longer at `path`. */
  missing: boolean;
}

export interface RecordProjectInput {
  path: string;
  name: string;
}

interface RcEntry {
  path: string;
  name: string;
}

function isRcEntry(value: unknown): value is RcEntry {
  const entry = value as Partial<RcEntry> | null;
  return typeof entry?.path === "string" && typeof entry.name === "string";
}

function invalid(file: string, cause?: unknown): ValidationError {
  return new ValidationError(`${file} is invalid`, { hint: "Fix the file by hand.", cause });
}

/** The whole file, so a write keeps the keys that are not Rowbly's projects. Nothing at `file` is an empty file. */
async function readRc(file: string): Promise<Record<string, unknown>> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
  let rc: unknown;
  try {
    rc = JSON.parse(text);
  } catch (error) {
    throw invalid(file, error);
  }
  if (typeof rc !== "object" || rc === null || Array.isArray(rc)) throw invalid(file);
  return rc as Record<string, unknown>;
}

function rcEntries(rc: Record<string, unknown>, file: string): RcEntry[] {
  const { projects = [] } = rc;
  if (!Array.isArray(projects) || !projects.every(isRcEntry)) throw invalid(file);
  return projects;
}

function rcPath(ctx: ServiceContext): string {
  return join(ctx.home ?? homedir(), RC_FILE);
}

/** The projects the user has opened, the most recent first. */
export async function listKnownProjects(ctx: ServiceContext = {}): Promise<KnownProject[]> {
  const file = rcPath(ctx);
  const entries = rcEntries(await readRc(file), file);
  return Promise.all(
    entries.map(async ({ path, name }) => ({
      path,
      name,
      missing: !(await pathExists(projectPaths(path).configFile)),
    })),
  );
}

/** Puts the project first in the list. It writes nothing when the project is already first, with the same name. */
export async function recordProject(input: RecordProjectInput, ctx: ServiceContext = {}): Promise<void> {
  const file = rcPath(ctx);
  const rc = await readRc(file);
  const entries = rcEntries(rc, file);
  if (entries[0]?.path === input.path && entries[0].name === input.name) return;
  const known = entries.find((entry) => entry.path === input.path);
  await writeRc(file, rc, [{ ...known, ...input }, ...entries.filter((entry) => entry !== known)]);
}

/** Takes the project at `path` out of the list. It does not touch the project, and writes nothing when it is not in the list. */
export async function forgetProject(path: string, ctx: ServiceContext = {}): Promise<void> {
  const file = rcPath(ctx);
  const rc = await readRc(file);
  const entries = rcEntries(rc, file);
  const projects = entries.filter((entry) => entry.path !== path);
  if (projects.length === entries.length) return;
  await writeRc(file, rc, projects);
}

async function writeRc(file: string, rc: Record<string, unknown>, projects: RcEntry[]): Promise<void> {
  // A dotfile manager often makes this file a link: write through the link and keep it.
  const target = await realpath(file).catch(() => file);
  await writeFileAtomic(target, `${JSON.stringify({ ...rc, projects }, null, 2)}\n`);
}
