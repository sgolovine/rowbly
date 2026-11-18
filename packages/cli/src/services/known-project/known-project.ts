import { randomUUID } from "node:crypto";
import { pathExists } from "../files/files.js";
import { invalidRc, rcPath, readRc, type UserRc, writeRc } from "../user-rc/user-rc.js";
import { projectPaths, type ServiceContext } from "../workspace/workspace.js";

export { RC_FILE } from "../user-rc/user-rc.js";

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

function rcEntries(rc: UserRc, file: string): RcEntry[] {
  const { projects = [] } = rc;

  if (!Array.isArray(projects) || !projects.every(isRcEntry)) {
    throw invalidRc(file);
  }

  return projects;
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
  const known = entries.find((entry) => entry.path === input.path);

  if (entries[0]?.path === input.path && entries[0].name === input.name) {
    return;
  }

  await writeRc(file, { ...rc, projects: [{ ...known, ...input }, ...entries.filter((entry) => entry !== known)] });
}

/** Takes the project at `path` out of the list. It does not touch the project, and writes nothing when it is not in the list. */
export async function forgetProject(path: string, ctx: ServiceContext = {}): Promise<void> {
  const file = rcPath(ctx);
  const rc = await readRc(file);
  const entries = rcEntries(rc, file);
  const projects = entries.filter((entry) => entry.path !== path);

  if (projects.length === entries.length) {
    return;
  }

  await writeRc(file, { ...rc, projects });
}

/** Gives the stored installation ID. Throws when the stored value is not a nonempty string. */
function storedDeviceId(rc: UserRc, file: string): string {
  if (typeof rc.deviceId !== "string" || !rc.deviceId.trim()) {
    throw invalidRc(file);
  }

  return rc.deviceId;
}

/** Returns the nonsecret installation ID. Invalid rc data stays unchanged. */
export async function getDeviceId(ctx: ServiceContext = {}): Promise<string> {
  const file = rcPath(ctx);
  const rc = await readRc(file);

  if (rc.deviceId !== undefined) {
    return storedDeviceId(rc, file);
  }

  const deviceId = randomUUID();

  await writeRc(file, { ...rc, deviceId }, { mode: 0o600 });

  return deviceId;
}
