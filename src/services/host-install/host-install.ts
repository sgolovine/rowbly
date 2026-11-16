import type { HostTransport, RemoteCommand } from "../host-transport/host-transport.js";
import { type LocalBuild, validateBuildId } from "./local-build.js";
import { checkHostNode } from "./node-check.js";

/** The root of the Rowbly files on a worker host, relative to the home folder of the SSH user. */
export const HOST_ROOT = ".local/share/rowbly";

/** The time limit of the install. `npm install` can take minutes. */
export const DEFAULT_INSTALL_TIMEOUT_MS = 10 * 60_000;

/** The output limit of `rowbly --version`. The output is one short line. */
const VERSION_OUTPUT_LIMIT = 4096;

/** The state of the Rowbly version on a host. A host with `version-mismatch` gets no work. */
export type HostVersionState = "ready" | "version-mismatch";

/** The result of `ensureHostVersion`. */
export interface HostVersionResult {
  readonly state: HostVersionState;
  readonly buildId: string;
  readonly localVersion: string;
  /** The version that the remote executable prints, or `null` when it cannot run. */
  readonly remoteVersion: string | null;
  readonly remoteExecutable: string;
  /** `true` when this call installed the build. */
  readonly installed: boolean;
  /** The output of `node --version` on the host. */
  readonly nodeVersion: string;
  /** The stderr of a failed install step. It is empty when no step failed. */
  readonly stderr: string;
}

export interface EnsureHostVersionOptions {
  readonly build: LocalBuild;
  readonly installTimeoutMs?: number;
}

/** The result of one install. */
export interface InstallOutcome {
  readonly ok: boolean;
  readonly stderr: string;
}

/** The private install folder of a build on the host, relative to the home folder. */
export function remoteVersionDir(buildId: string): string {
  validateBuildId(buildId);

  return `${HOST_ROOT}/versions/${buildId}`;
}

/** The Rowbly executable of a build on the host, relative to the home folder. SSH starts remote commands there. */
export function remoteRowblyPath(buildId: string): string {
  return `${remoteVersionDir(buildId)}/node_modules/.bin/rowbly`;
}

/** The path of the uploaded package of an unreleased build on the host, relative to the home folder. */
export function remotePackagePath(buildId: string): string {
  validateBuildId(buildId);

  return `${HOST_ROOT}/packages/${buildId}.tgz`;
}

/** Gives the version that the remote executable of the build prints, or `null` when it cannot run. */
export async function remoteVersion(transport: HostTransport, buildId: string): Promise<string | null> {
  const result = await transport.bytes([remoteRowblyPath(buildId), "--version"], null, { limit: VERSION_OUTPUT_LIMIT });
  const text = result.bytes.toString("utf8").trim();

  return result.exitCode === 0 && text !== "" ? text : null;
}

function npmInstall(buildId: string, spec: string): RemoteCommand {
  return ["npm", "install", "--prefix", remoteVersionDir(buildId), "--no-save", "--omit=dev", spec];
}

function failed(stderr: string, fallback: string): InstallOutcome {
  return { ok: false, stderr: stderr.trim() === "" ? fallback : stderr };
}

/** Sends the package of an unreleased build to `remotePackagePath` on the host. */
async function uploadPackage(transport: HostTransport, build: LocalBuild, timeoutMs: number): Promise<InstallOutcome> {
  const path = remotePackagePath(build.id);

  if (!build.pack) {
    return failed("", "The unreleased build has no package.");
  }

  const folder = await transport.bytes(["mkdir", "-p", `${HOST_ROOT}/packages`], null, { timeoutMs });

  if (folder.exitCode !== 0) {
    return failed(folder.stderr, `mkdir exited with code ${folder.exitCode}.`);
  }

  const data = await build.pack();
  const upload = await transport.upload(["dd", `of=${path}`, "status=none"], data, { timeoutMs });

  return upload.exitCode === 0
    ? { ok: true, stderr: "" }
    : failed(upload.stderr, `dd exited with code ${upload.exitCode}.`);
}

/** The npm package spec: the registry version of a released build, or the uploaded package of an unreleased build. */
function packageSpec(build: LocalBuild): string {
  return build.released ? `rowbly@${build.version}` : `./${remotePackagePath(build.id)}`;
}

/** Installs the build in its private folder on the host. An unreleased build uploads its package first. */
export async function installBuild(
  transport: HostTransport,
  build: LocalBuild,
  timeoutMs: number = DEFAULT_INSTALL_TIMEOUT_MS,
): Promise<InstallOutcome> {
  const upload = build.released ? { ok: true, stderr: "" } : await uploadPackage(transport, build, timeoutMs);

  if (!upload.ok) {
    return upload;
  }

  const result = await transport.bytes(npmInstall(build.id, packageSpec(build)), null, { timeoutMs });

  return result.exitCode === 0
    ? { ok: true, stderr: "" }
    : failed(result.stderr, `npm exited with code ${result.exitCode}.`);
}

/**
 * The version step of each connection. It checks Node, then installs the build only when the remote executable
 * is missing or prints a different version. It throws for a missing or old Node.
 */
export async function ensureHostVersion(
  transport: HostTransport,
  options: EnsureHostVersionOptions,
): Promise<HostVersionResult> {
  const { build } = options;

  validateBuildId(build.id);

  const nodeVersion = await checkHostNode(transport);
  const before = await remoteVersion(transport, build.id);
  const base = {
    buildId: build.id,
    localVersion: build.version,
    remoteExecutable: remoteRowblyPath(build.id),
    nodeVersion,
  };

  if (before === build.version) {
    return { ...base, state: "ready", remoteVersion: before, installed: false, stderr: "" };
  }

  const install = await installBuild(transport, build, options.installTimeoutMs ?? DEFAULT_INSTALL_TIMEOUT_MS);

  if (!install.ok) {
    return { ...base, state: "version-mismatch", remoteVersion: before, installed: false, stderr: install.stderr };
  }

  const after = await remoteVersion(transport, build.id);
  const state: HostVersionState = after === build.version ? "ready" : "version-mismatch";

  return { ...base, state, remoteVersion: after, installed: true, stderr: "" };
}
