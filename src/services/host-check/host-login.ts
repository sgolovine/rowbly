import { remoteRowblyPath } from "../host-install/host-install.js";
import { type LocalBuild, localBuild } from "../host-install/local-build.js";
import {
  ensureControlDir,
  type SshSettings,
  sshOptions,
  sshSettings,
  validateCommand,
  validateTarget,
} from "../host-transport/ssh-transport.js";
import type { ServiceContext } from "../workspace/workspace.js";
import { findHost } from "./host-check.js";

/** The process that logs in to Pi on the host. The front end starts it in the terminal of the user. */
export interface HostLogin {
  readonly host: string;
  readonly executable: string;
  readonly args: readonly string[];
}

/** The build of the login. Tests give a fake build. */
export interface HostLoginDeps {
  readonly build?: () => Promise<LocalBuild>;
  /** The settings of the SSH connection. Tests give a stub executable and a private folder. */
  readonly ssh?: Partial<Omit<SshSettings, "target">>;
}

/**
 * Gives the SSH arguments of `rowbly auth login` on the host. `-t` gives the remote prompt a terminal. The options
 * are the same as for each SSH call, so the login uses the key and the shared connection.
 */
export function hostLoginArguments(settings: SshSettings, remoteExecutable: string): string[] {
  const command = [remoteExecutable, "auth", "login"];

  validateTarget(settings.target);
  validateCommand(command);

  return ["-t", ...sshOptions(settings), "--", settings.target, ...command];
}

/** Finds the host and gives the SSH process of the login. It does not start the process. */
export async function hostLogin(
  input: { readonly id: string },
  ctx: ServiceContext = {},
  deps: HostLoginDeps = {},
): Promise<HostLogin> {
  const host = await findHost(input.id, ctx);
  const build = await (deps.build ?? localBuild)();
  const settings = sshSettings({ ...deps.ssh, target: host.ssh });
  const args = hostLoginArguments(settings, remoteRowblyPath(build.id));

  await ensureControlDir(settings);

  return { host: host.id, executable: settings.sshExecutable, args };
}
