import { createHash } from "node:crypto";
import { basename } from "node:path";
import { ValidationError } from "../errors/errors.js";
import { HOST_ROOT } from "../host-install/host-install.js";
import { isSafeToken } from "../host-transport/ssh-transport.js";

const HASH_LENGTH = 12;

/** The ID of a Project on a host: `<name>-<hash>`, so that two Projects with the same name do not share a folder. */
export function hostProjectId(root: string): string {
  const name = basename(root)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const hash = createHash("sha256").update(root).digest("hex").slice(0, HASH_LENGTH);

  return `${name === "" ? "project" : name}-${hash}`;
}

/** The managed clone of a Project on a host, relative to the home folder of the SSH user. */
export function managedClonePath(root: string): string {
  return `${HOST_ROOT}/projects/${hostProjectId(root)}/repo`;
}

/** The folder of the worker worktrees next to a clone, in the layout of the main machine: `<clone>-worktrees`. */
export function remoteWorktreesDir(path: string): string {
  return `${path}-worktrees`;
}

function unsafe(field: string, value: string, message: string): ValidationError {
  return new ValidationError(`The ${field} ${JSON.stringify(value)} cannot go to a worker host.`, {
    details: { issues: [{ path: [field], message }] },
  });
}

/** Refuses a value that the remote shell can change, or that a remote program can read as an option. */
export function validateRemoteToken(field: string, value: string): void {
  if (value === "" || value.startsWith("-") || !isSafeToken(value)) {
    throw unsafe(field, value, "Use only A-Z, a-z, 0-9 and . _ / = : @ -, and do not start with -.");
  }
}

/** Gives the clone path of `--path`. A leading `~/` becomes a path relative to the home folder. */
export function remoteClonePath(path: string): string {
  const relative = path.startsWith("~/") ? path.slice(2) : path;
  const trimmed = relative.length > 1 ? relative.replace(/\/+$/, "") : relative;

  validateRemoteToken("path", trimmed);

  return trimmed;
}
