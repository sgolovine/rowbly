import { ValidationError } from "../errors/errors.js";
import { LOCAL_HOST } from "../thread/thread-types.js";
import { invalidRc, type UserRc } from "../user-rc/user-rc.js";

/** A worker host: a remote machine that runs factory workers only. */
export interface Host {
  /** The dash-case ID of the host. `local` is the main machine and is not a worker host. */
  readonly id: string;
  /** The SSH target, for example `user@mini.lan`. It is always one argument of `ssh`, never shell text. */
  readonly ssh: string;
  /** The largest number of workers that run on the host at one time, for all Projects. */
  readonly maxWorkers: number;
  /** The factory gives work to the host only when it is on. */
  readonly enabled: boolean;
}

/** The record of one Project that a worker host uses. */
export interface HostProject {
  /** The absolute path of the local Project root, the same value as the list of known Projects. */
  readonly root: string;
  /** The clone on the host, relative to the home folder of the SSH user, or absolute. */
  readonly path: string;
  /** `true` when Rowbly made the clone in its own folder on the host. */
  readonly managed: boolean;
}

/** A host entry of the file. `projects` is the list of the Projects that the host uses. */
export interface HostEntry extends Host {
  readonly projects?: readonly HostProject[];
}

export interface HostInput {
  readonly id: string;
  readonly ssh: string;
  readonly maxWorkers: number;
}

interface Issue {
  readonly path: readonly string[];
  readonly message: string;
}

const HOST_ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;

// Whitespace would split the target into more arguments, and a control character can change the terminal.
const UNSAFE_SSH = /[\s\p{Cc}]/u;

function isHostProject(value: unknown): value is HostProject {
  const project = value as Partial<HostProject> | null;

  return (
    typeof project === "object" &&
    project !== null &&
    typeof project.root === "string" &&
    typeof project.path === "string" &&
    typeof project.managed === "boolean"
  );
}

function hasValidProjects(host: Partial<HostEntry>): boolean {
  return host.projects === undefined || (Array.isArray(host.projects) && host.projects.every(isHostProject));
}

function isHost(value: unknown): value is HostEntry {
  const host = value as Partial<HostEntry> | null;

  return (
    typeof host === "object" &&
    host !== null &&
    typeof host.id === "string" &&
    typeof host.ssh === "string" &&
    typeof host.maxWorkers === "number" &&
    typeof host.enabled === "boolean" &&
    hasValidProjects(host)
  );
}

/** The `hosts` entries of the file, in the order of the file. A missing key is an empty list. Any bad entry throws. */
export function rcHosts(rc: UserRc, file: string): readonly HostEntry[] {
  const { hosts = [] } = rc;

  if (!Array.isArray(hosts) || !hosts.every(isHost)) {
    throw invalidRc(file);
  }

  return hosts;
}

/** The Projects that the host uses. A missing key is an empty list. */
export function hostProjects(host: HostEntry): readonly HostProject[] {
  return host.projects ?? [];
}

/** Gives only the fields of a host. An entry in the file can have more keys, which a write keeps. */
export function hostView(host: Host): Host {
  return { id: host.id, ssh: host.ssh, maxWorkers: host.maxWorkers, enabled: host.enabled };
}

function idIssue(id: string): Issue | undefined {
  if (id === LOCAL_HOST) {
    return { path: ["id"], message: `The host ID "${LOCAL_HOST}" is reserved for the main machine` };
  }

  if (!HOST_ID.test(id)) {
    return { path: ["id"], message: `The host ID "${id}" must be dash-case, for example mac-mini` };
  }

  return undefined;
}

function sshIssue(ssh: string): Issue | undefined {
  if (ssh === "") {
    return { path: ["ssh"], message: "The SSH target must not be empty" };
  }

  if (ssh.startsWith("-")) {
    return { path: ["ssh"], message: "The SSH target must not start with -" };
  }

  if (UNSAFE_SSH.test(ssh)) {
    return { path: ["ssh"], message: "The SSH target must not have whitespace or control characters" };
  }

  return undefined;
}

function maxWorkersIssue(maxWorkers: number): Issue | undefined {
  if (!Number.isSafeInteger(maxWorkers) || maxWorkers < 1) {
    return { path: ["maxWorkers"], message: "The worker limit must be a whole number of 1 or more" };
  }

  return undefined;
}

/** Throws a `ValidationError` with one issue for each bad field of the input. */
export function validateHostInput(input: HostInput): void {
  const issues = [idIssue(input.id), sshIssue(input.ssh), maxWorkersIssue(input.maxWorkers)].filter(
    (issue): issue is Issue => issue !== undefined,
  );
  const [first] = issues;

  if (first) {
    throw new ValidationError(first.message, { details: { issues } });
  }
}
