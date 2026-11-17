import type { HostProject } from "../host/host-rules.js";
import type { HostTransport, RemoteCommand } from "../host-transport/host-transport.js";
import { HostCloneFailedError, HostGitAccessError } from "./host-project-errors.js";
import { sameRepository } from "./repo-url.js";

/** The time limit of `git clone`. A large repository can take many minutes. */
export const CLONE_TIMEOUT_MS = 30 * 60_000;

/** The state of the clone of a Project on a host. */
export type CloneState = "ok" | "missing" | "not-a-repository" | "different-repository";

/** The result of `cloneStatus`. `origin` is the `origin` URL of the clone, or `null` when it has none. */
export interface CloneStatus {
  readonly state: CloneState;
  readonly path: string;
  readonly origin: string | null;
}

/** Where to clone the repository, and from which URL. */
export interface CloneTarget {
  readonly url: string;
  readonly path: string;
  /** The SSH target of the host. It goes in the hint of an access error. */
  readonly ssh: string;
}

// Git has no exit code for an access failure, so these messages of Git and SSH identify it.
const ACCESS_FAILURES = [
  /permission denied \(publickey/i,
  /authentication failed/i,
  /could not read (username|password)/i,
  /repository not found/i,
  /host key verification failed/i,
  /terminal prompts disabled/i,
];

interface RemoteOutput {
  readonly exitCode: number;
  readonly text: string;
  readonly stderr: string;
}

async function runRemote(transport: HostTransport, command: RemoteCommand, timeoutMs?: number): Promise<RemoteOutput> {
  const result = await transport.bytes(command, null, timeoutMs === undefined ? {} : { timeoutMs });

  return { exitCode: result.exitCode, text: result.bytes.toString("utf8").trim(), stderr: result.stderr };
}

/** `true` when something is at the path on the host. */
export async function remotePathExists(transport: HostTransport, path: string): Promise<boolean> {
  return (await runRemote(transport, ["test", "-e", path])).exitCode === 0;
}

async function isWorkTree(transport: HostTransport, path: string): Promise<boolean> {
  const result = await runRemote(transport, ["git", "-C", path, "rev-parse", "--is-inside-work-tree"]);

  return result.exitCode === 0 && result.text === "true";
}

async function remoteOrigin(transport: HostTransport, path: string): Promise<string | null> {
  const result = await runRemote(transport, ["git", "-C", path, "remote", "get-url", "origin"]);

  return result.exitCode === 0 && result.text !== "" ? result.text : null;
}

/** `true` when `git status --porcelain` of the clone gives no output. */
export async function isCleanClone(transport: HostTransport, path: string): Promise<boolean> {
  const result = await runRemote(transport, ["git", "-C", path, "status", "--porcelain"]);

  return result.exitCode === 0 && result.text === "";
}

/** Examines the clone of a Project on a host: it must be a Git work tree with an `origin` of the same repository. */
export async function cloneStatus(transport: HostTransport, record: HostProject, url: string): Promise<CloneStatus> {
  const { path } = record;

  if (!(await remotePathExists(transport, path))) {
    return { state: "missing", path, origin: null };
  }

  if (!(await isWorkTree(transport, path))) {
    return { state: "not-a-repository", path, origin: null };
  }

  const origin = await remoteOrigin(transport, path);
  const same = origin !== null && sameRepository(origin, url);

  return { state: same ? "ok" : "different-repository", path, origin };
}

function cloneError(target: CloneTarget, stderr: string, exitCode: number): Error {
  const details = { url: target.url, path: target.path, target: target.ssh, exitCode, stderr };

  if (ACCESS_FAILURES.some((pattern) => pattern.test(stderr))) {
    return new HostGitAccessError(`The host ${target.ssh} cannot read the repository ${target.url}.`, {
      details,
      hint: `Fix the Git access on the host: log in with \`ssh ${target.ssh}\`, then run \`git ls-remote ${target.url}\`.`,
    });
  }

  return new HostCloneFailedError(`git clone of ${target.url} failed on ${target.ssh}.`, {
    details,
    hint: "Read the stderr in the details, repair the cause on the host, then run the command again.",
  });
}

/** Clones the repository into the path on the host. `git clone` makes the parent folders. */
export async function cloneOnHost(transport: HostTransport, target: CloneTarget): Promise<void> {
  const command = ["env", "GIT_TERMINAL_PROMPT=0", "git", "clone", "--", target.url, target.path];
  const result = await runRemote(transport, command, CLONE_TIMEOUT_MS);

  if (result.exitCode !== 0) {
    throw cloneError(target, result.stderr, result.exitCode);
  }
}
