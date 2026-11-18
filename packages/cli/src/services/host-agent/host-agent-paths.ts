import { chmod, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { ValidationError } from "../errors/errors.js";
import { HOST_ROOT } from "../host-install/host-install.js";
import { remoteWorktreesDir } from "../host-project/host-paths.js";

/** A project id is a dash-case token of 1 to 64 characters. The main machine makes it. */
const PROJECT_ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const PROJECT_ID_LIMIT = 64;

const STORY_ID = /^[A-Z][A-Z0-9]*-\d+$/;

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
  /** The folder of each Thread: `threads/<thread-id>/`. */
  readonly threads: string;
  /** The runtime folder of the local executor. The session files are in `runtime/sessions/<thread-id>/`. */
  readonly runtime: string;
  /** The attachment cache of the Project, by attachment id. The files have any type. */
  readonly attachments: string;
  /** The CLI shim of the workers. */
  readonly bin: string;
  /** The fetch requests of the workers for attachment files that are not on the host: `fetch/<id>.json`. */
  readonly fetch: string;
  /** The live mark of the `host attach` channel. It holds the process identity of the channel. */
  readonly channel: string;
}

/** The files of one Thread on the host. */
export interface ThreadPaths {
  readonly dir: string;
  /** The copy root. It contains `.rowbly/`. */
  readonly copy: string;
  /** The prepared launch data. */
  readonly launch: string;
  /** The run state. */
  readonly run: string;
  /** The `flock` file of the worker command prefix. */
  readonly lock: string;
}

/** The input of `hostRunPaths`. A relative clone path is relative to the home folder. */
export interface HostRunInput {
  readonly home: string;
  readonly projectId: string;
  readonly clone: string;
  readonly threadId: string;
  readonly storyId: string;
}

/** The paths of a remote worker run that the worker message gives. */
export interface HostRunPaths {
  readonly clone: string;
  /** The copy root. The worker CLI gets `-C <copy>`. */
  readonly copy: string;
  readonly worktree: string;
  readonly lock: string;
  readonly shim: string;
  readonly outbox: string;
}

/** The files of the machine slots, for all Projects on the host. */
export interface SlotPaths {
  readonly dir: string;
  readonly limit: string;
  readonly lock: string;
}

/** True for a request id or a Thread id: `[A-Za-z0-9_-]{1,128}`. */
export function validRequestId(id: unknown): id is string {
  return typeof id === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(id);
}

/** Gives the Thread id, or throws a ValidationError before a path is made from it. */
export function validateThreadId(threadId: unknown): string {
  if (!validRequestId(threadId)) {
    throw new ValidationError("A Thread id must have 1 to 128 characters A-Z, a-z, 0-9, _ or -", {
      details: { threadId },
    });
  }

  return threadId;
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
  return agentPathsIn(join(hostRoot(home), "projects", validateProjectId(projectId), "agent"), projectId);
}

/**
 * Gives the paths of the runtime folder `dir`, for example from `ROWBLY_HOST_AGENT`. The folder name above `dir` is
 * the project id. A relative folder or a bad project id gives a ValidationError.
 */
export function hostAgentPathsAt(dir: string): HostAgentPaths {
  if (!isAbsolute(dir)) {
    throw new ValidationError(`The host agent folder must be an absolute path: ${dir}`);
  }

  const resolved = resolve(dir);

  return agentPathsIn(resolved, validateProjectId(basename(dirname(resolved))));
}

function agentPathsIn(dir: string, projectId: string): HostAgentPaths {
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
    threads: join(dir, "threads"),
    runtime: join(dir, "runtime"),
    attachments: join(dir, "attachments"),
    bin: join(dir, "bin", "rowbly"),
    fetch: join(dir, "fetch"),
    channel: join(dir, "channel.json"),
  };
}

/** Gives the files of one Thread. A bad Thread id gives a ValidationError. */
export function threadPaths(paths: HostAgentPaths, threadId: string): ThreadPaths {
  const dir = join(paths.threads, validateThreadId(threadId));

  return {
    dir,
    copy: join(dir, "copy"),
    launch: join(dir, "launch.json"),
    run: join(dir, "run.json"),
    lock: join(dir, "write.lock"),
  };
}

/** Gives the Story id, or throws a ValidationError before a path is made from it. */
export function validateStoryId(storyId: unknown): string {
  if (typeof storyId !== "string" || !STORY_ID.test(storyId)) {
    throw new ValidationError("Invalid Story ID", { details: { storyId } });
  }

  return storyId;
}

/** Gives the absolute paths of a remote worker run on the host. It reads no file. */
export function hostRunPaths(input: HostRunInput): HostRunPaths {
  validateStoryId(input.storyId);

  const paths = hostAgentPaths(input.projectId, input.home);
  const thread = threadPaths(paths, input.threadId);
  const clone = resolve(input.home, input.clone);

  return {
    clone,
    copy: thread.copy,
    worktree: join(remoteWorktreesDir(clone), input.storyId),
    lock: thread.lock,
    shim: paths.bin,
    outbox: paths.outbox,
  };
}

/**
 * Gives the run paths for the input `{ threadId, storyId, clone }` of `host run-paths`. The main machine does not
 * know the home folder of the host, so the host gives the absolute paths of the worker message.
 */
export function hostRunPathsAnswer(projectId: string, value: unknown, home: string = homedir()): HostRunPaths {
  const input = (value ?? {}) as Partial<HostRunInput>;

  if (typeof input.clone !== "string" || input.clone.trim() === "") {
    throw new ValidationError('The input must be { "threadId": "<id>", "storyId": "<id>", "clone": "<path>" }');
  }

  return hostRunPaths({
    home,
    projectId,
    clone: input.clone,
    threadId: validateThreadId(input.threadId),
    storyId: validateStoryId(input.storyId),
  });
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
  await Promise.all(
    [
      paths.control,
      paths.receipts,
      paths.outbox,
      paths.logs,
      paths.threads,
      paths.runtime,
      paths.attachments,
      paths.fetch,
    ].map(ensurePrivateDir),
  );
}
