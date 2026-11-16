import { chmod, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { ValidationError } from "../errors/errors.js";
import { HOST_ROOT } from "../host-install/host-install.js";

/** A project id is a dash-case token of 1 to 64 characters. The main machine makes it. */
const PROJECT_ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const PROJECT_ID_LIMIT = 64;

/** The private runtime files of the host agent of one Project. */
export interface HostAgentPaths {
  readonly projectId: string;
  /** The runtime folder: `<home>/.local/share/rowbly/projects/<project-id>/agent/`. */
  readonly dir: string;
  readonly lock: string;
  readonly guard: string;
  readonly state: string;
  readonly control: string;
  readonly receipts: string;
  readonly outbox: string;
  readonly logs: string;
}

/** The files of the machine slots, for all Projects on the host. */
export interface SlotPaths {
  readonly dir: string;
  readonly limit: string;
  readonly lock: string;
}

/** Gives the project id, or throws a ValidationError before a file is written. */
export function validateProjectId(projectId: unknown): string {
  if (typeof projectId !== "string" || projectId.length > PROJECT_ID_LIMIT || !PROJECT_ID.test(projectId)) {
    throw new ValidationError(`A project id must be a dash-case token of 1 to ${PROJECT_ID_LIMIT} characters`, {
      details: { projectId },
    });
  }

  return projectId;
}

/** The root of the Rowbly files on this host, below the home folder. */
function hostRoot(home: string): string {
  return join(home, HOST_ROOT);
}

/** Gives the paths of the runtime folder of the Project. A bad project id gives a ValidationError. */
export function hostAgentPaths(projectId: string, home: string = homedir()): HostAgentPaths {
  const dir = join(hostRoot(home), "projects", validateProjectId(projectId), "agent");

  return {
    projectId,
    dir,
    lock: join(dir, "agent.lock"),
    guard: join(dir, "agent.guard"),
    state: join(dir, "agent.json"),
    control: join(dir, "control"),
    receipts: join(dir, "receipts"),
    outbox: join(dir, "outbox"),
    logs: join(dir, "logs"),
  };
}

/** Gives the paths of the machine slots below the home folder. */
export function slotPaths(home: string = homedir()): SlotPaths {
  const dir = join(hostRoot(home), "slots");

  return { dir, limit: join(dir, "limit.json"), lock: join(dir, "slots.lock") };
}

/** Makes the folder and its missing parents with mode 0700. A folder that exists also gets mode 0700. */
export async function ensurePrivateDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 });
  await chmod(path, 0o700);
}

/** Makes the runtime folder of the Project and its subfolders, each with mode 0700. */
export async function prepareAgentDirs(paths: HostAgentPaths): Promise<void> {
  await ensurePrivateDir(paths.dir);
  await Promise.all([paths.control, paths.receipts, paths.outbox, paths.logs].map(ensurePrivateDir));
}
