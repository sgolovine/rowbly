import { RowblyError } from "../errors/errors.js";
import { remoteRowblyPath, remoteVersion } from "../host-install/host-install.js";
import { HostNodeMissingError, HostNodeTooOldError } from "../host-install/host-install-errors.js";
import { checkHostNode } from "../host-install/node-check.js";
import type { BytesResult, RemoteCommand } from "../host-transport/host-transport.js";
import {
  type CheckEnv,
  type CheckItem,
  type CheckItemId,
  failureText,
  firstLine,
  item,
  runRemote,
  stdoutText,
  transportFailure,
} from "./check-item.js";

/** A remote command that passes when it exits with code 0. */
interface CommandCheck {
  readonly id: CheckItemId;
  readonly command: RemoteCommand;
  readonly action: string;
}

/** The first remote call of the check. Its output also gives the `linux` item. */
export const UNAME_COMMAND: RemoteCommand = ["uname", "-s"];

/** The `linux` item from the output of `uname -s`. */
export function linuxItem(result: BytesResult): CheckItem {
  const system = stdoutText(result);

  if (result.exitCode === 0 && system === "Linux") {
    return item("linux", "ok", system);
  }

  return item(
    "linux",
    "fail",
    result.exitCode === 0 ? `uname -s gives ${firstLine(system, "no text")}` : failureText(result),
    "Use a Linux host. Rowbly runs workers only on Linux.",
  );
}

/** Runs a command check. Exit code 0 is `ok` with the first line of the output. */
export async function commandItem(env: CheckEnv, check: CommandCheck): Promise<CheckItem> {
  const outcome = await runRemote(env, check.command);

  if (!outcome.ok) {
    return transportFailure(env, check.id, outcome.error);
  }

  const { result } = outcome;

  if (result.exitCode !== 0) {
    return item(check.id, "fail", failureText(result), check.action);
  }

  return item(check.id, "ok", firstLine(stdoutText(result), firstLine(result.stderr, "passed")));
}

/** The `flock` item. The factory uses `flock` for the Project write lock. */
export function flockItem(env: CheckEnv): Promise<CheckItem> {
  return commandItem(env, {
    id: "flock",
    command: ["flock", "--version"],
    action: "Install flock on the host, for example from the util-linux package.",
  });
}

/** The `git` item. */
export function gitItem(env: CheckEnv): Promise<CheckItem> {
  return commandItem(env, { id: "git", command: ["git", "--version"], action: "Install Git on the host." });
}

/** The `gh` item. Workers open pull requests with the GitHub CLI. */
export function ghItem(env: CheckEnv): Promise<CheckItem> {
  return commandItem(env, { id: "gh", command: ["gh", "auth", "status"], action: "Run gh auth login on the host." });
}

/** The `node` item. It uses the Node check of the install. */
export async function nodeItem(env: CheckEnv): Promise<CheckItem> {
  try {
    return item("node", "ok", await checkHostNode(env.transport));
  } catch (error) {
    if (!(error instanceof RowblyError)) {
      throw error;
    }

    return error instanceof HostNodeMissingError || error instanceof HostNodeTooOldError
      ? item("node", "fail", error.message, error.hint ?? "Install Node 22.19 or later on the host.")
      : transportFailure(env, "node", error);
  }
}

function versionAction(env: CheckEnv): string {
  return `Run rowbly host remove ${env.hostId}, then rowbly host add ${env.hostId} again to install Rowbly ${env.build.version}.`;
}

/** The `rowbly` item: the remote executable of the local build prints the local version. */
export async function rowblyItem(env: CheckEnv): Promise<CheckItem> {
  const executable = remoteRowblyPath(env.build.id);

  try {
    const version = await remoteVersion(env.transport, env.build.id);

    if (version === env.build.version) {
      return item("rowbly", "ok", `Rowbly ${version} at ${executable}`);
    }

    const found = version === null ? `${executable} cannot run` : `${executable} prints ${version}`;

    return item("rowbly", "fail", `${found}; the main machine has ${env.build.version}`, versionAction(env));
  } catch (error) {
    if (!(error instanceof RowblyError)) {
      throw error;
    }

    return transportFailure(env, "rowbly", error);
  }
}

function configCommand(clone: string | undefined, key: string): RemoteCommand {
  return clone === undefined ? ["git", "config", "--get", key] : ["git", "-C", clone, "config", "--get", key];
}

/** Reads one Git config value. It gives the value, `undefined` for no value, or the item for a transport error. */
async function configValue(
  env: CheckEnv,
  clone: string | undefined,
  key: string,
): Promise<string | CheckItem | undefined> {
  const outcome = await runRemote(env, configCommand(clone, key));

  if (!outcome.ok) {
    return transportFailure(env, "git-identity", outcome.error);
  }

  const value = stdoutText(outcome.result);

  return outcome.result.exitCode === 0 && value !== "" ? value : undefined;
}

const IDENTITY_ACTION =
  'Run git config --global user.name "<name>" and git config --global user.email "<email>" on the host.';

/** The `git-identity` item. With a clone, a value of the clone counts, because Git uses it first. */
export async function identityItem(env: CheckEnv, clone: string | undefined): Promise<CheckItem> {
  const name = await configValue(env, clone, "user.name");
  const email = await configValue(env, clone, "user.email");

  if (typeof name === "object") {
    return name;
  }

  if (typeof email === "object") {
    return email;
  }

  if (name === undefined || email === undefined) {
    const missing = [name === undefined ? "user.name" : "", email === undefined ? "user.email" : ""].filter(Boolean);

    return item("git-identity", "fail", `${missing.join(" and ")} has no value`, IDENTITY_ACTION);
  }

  return item("git-identity", "ok", `${name} <${email}>`);
}
