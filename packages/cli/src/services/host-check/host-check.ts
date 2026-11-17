import { NotFoundError, RowblyError } from "../errors/errors.js";
import { recordLastCheck } from "../host/host-last-check.js";
import { type Host, hostView, rcHosts } from "../host/host-rules.js";
import { remoteVersion } from "../host-install/host-install.js";
import { type LocalBuild, localBuild } from "../host-install/local-build.js";
import type { HostTransport } from "../host-transport/host-transport.js";
import { createSshTransport } from "../host-transport/ssh-transport.js";
import { rcPath, readRc } from "../user-rc/user-rc.js";
import type { ServiceContext } from "../workspace/workspace.js";
import {
  CHECK_ITEM_IDS,
  type CheckEnv,
  type CheckItem,
  type CloneFinder,
  item,
  type ProjectFacts,
  runRemote,
  skipped,
} from "./check-item.js";
import { hostCloneFinder } from "./clone-finder.js";
import {
  flockItem,
  ghItem,
  gitItem,
  identityItem,
  linuxItem,
  nodeItem,
  rowblyItem,
  UNAME_COMMAND,
} from "./host-items.js";
import { hostProviders, modelsItem, piLoginItem } from "./pi-items.js";
import {
  cloneItem,
  countLocalAhead,
  type LocalAheadCounter,
  localAheadItem,
  projectFacts,
  pushItem,
} from "./project-items.js";

export type { CheckItem } from "./check-item.js";

/** The connection, the build and the local facts of a check. Tests replace them. */
export interface HostCheckDeps {
  readonly transportFor?: (target: string) => HostTransport;
  readonly build?: () => Promise<LocalBuild>;
  /** Finds the clone of the Project on the host. The default uses the records of `rowbly host use`. */
  readonly cloneFor?: CloneFinder;
  readonly localAhead?: LocalAheadCounter;
}

/** The checklist of one worker host. The host is ready when no item is `fail`. */
export interface HostCheck {
  readonly host: string;
  readonly ready: boolean;
  readonly items: readonly CheckItem[];
}

/** The input of `runHostCheck`: a host, its connection and its build. */
export interface HostCheckRun {
  readonly hostId: string;
  readonly transport: HostTransport;
  readonly build: LocalBuild;
}

/** The result of the short check of the main machine. */
export interface QuickHostCheck {
  readonly ready: boolean;
  /** The configured Pi providers of the host. The placement uses them. */
  readonly providers: readonly string[];
  readonly problems: readonly string[];
}

const PI_SKIP = "Pi needs Node and the Rowbly version on the host.";

function result(hostId: string, items: readonly CheckItem[]): HostCheck {
  return { host: hostId, ready: items.every((entry) => entry.state !== "fail"), items };
}

/** The items after a failed SSH call: `ssh` is `fail`, and each other item is `skipped`. */
function sshFailed(env: CheckEnv, error: RowblyError): HostCheck {
  const action = error.hint ?? `Make sure that ssh works to the host without a password.`;
  const others = CHECK_ITEM_IDS.slice(1).map((id) => skipped(id, "SSH does not work."));

  return result(env.hostId, [item("ssh", "fail", error.message, action), ...others]);
}

/** The `pi-login` and `models` items. They need the remote executable, so they are skipped when it cannot run. */
async function piItems(env: CheckEnv, system: readonly CheckItem[]): Promise<CheckItem[]> {
  const runnable = system.every((entry) => (entry.id !== "node" && entry.id !== "rowbly") || entry.state === "ok");

  if (!runnable) {
    return [skipped("pi-login", PI_SKIP), env.project ? skipped("models", PI_SKIP) : await modelsItem(env)];
  }

  return [await piLoginItem(env), await modelsItem(env)];
}

/** The items after the SSH call passed. */
async function laterItems(env: CheckEnv, ctx: ServiceContext, deps: HostCheckDeps): Promise<CheckItem[]> {
  const system = [await flockItem(env), await gitItem(env), await nodeItem(env), await rowblyItem(env)];
  const pi = await piItems(env, system);
  const clone = await cloneItem(env, deps.cloneFor ?? hostCloneFinder(ctx));
  const push = await pushItem(env, clone.path);
  const gh = await ghItem(env);
  const identity = await identityItem(env, clone.path);
  const ahead = await localAheadItem(env, deps.localAhead ?? countLocalAhead);

  return [...system, ...pi, clone.item, push, gh, identity, ahead];
}

async function checkItems(run: HostCheckRun, ctx: ServiceContext, deps: HostCheckDeps): Promise<HostCheck> {
  const project: ProjectFacts | undefined = await projectFacts(ctx);
  const env: CheckEnv = { ...run, project };
  const first = await runRemote(env, UNAME_COMMAND);

  if (!first.ok) {
    return sshFailed(env, first.error);
  }

  const items = await laterItems(env, ctx, deps);

  return result(env.hostId, [item("ssh", "ok", "SSH connects without a password"), linuxItem(first.result), ...items]);
}

/**
 * Runs each item of the check on a host with a known connection and build. It does not install, log in or clone.
 * A failed item does not throw. It records the summary as the `lastCheck` of the host. `addHost` uses it after the
 * install.
 */
export async function runHostCheck(
  run: HostCheckRun,
  ctx: ServiceContext = {},
  deps: HostCheckDeps = {},
): Promise<HostCheck> {
  const check = await checkItems(run, ctx, deps);

  await recordLastCheck(run.hostId, check, ctx);

  return check;
}

/** Finds a recorded worker host, or throws `NOT_FOUND`. */
export async function findHost(id: string, ctx: ServiceContext): Promise<Host> {
  const file = rcPath(ctx);
  const hosts = rcHosts(await readRc(file), file);
  const host = hosts.find((entry) => entry.id === id);

  if (!host) {
    throw new NotFoundError(`Host "${id}" not found`, { details: { hosts: hosts.map((entry) => entry.id) } });
  }

  return hostView(host);
}

/** Shows if a recorded worker host is ready, as a checklist with an action for each failed item. */
export async function checkHost(
  input: { readonly id: string },
  ctx: ServiceContext = {},
  deps: HostCheckDeps = {},
): Promise<HostCheck> {
  const host = await findHost(input.id, ctx);
  const transport = (deps.transportFor ?? ((target) => createSshTransport({ target })))(host.ssh);
  const build = await (deps.build ?? localBuild)();

  return runHostCheck({ hostId: host.id, transport, build }, ctx, deps);
}

function notReady(problem: string): QuickHostCheck {
  return { ready: false, providers: [], problems: [problem] };
}

/**
 * The short check of the main machine: SSH, the Rowbly version and the Pi providers of the host. It does not install.
 * A failed short check makes the host not ready.
 */
export async function quickHostCheck(transport: HostTransport, build: LocalBuild): Promise<QuickHostCheck> {
  const env: CheckEnv = { hostId: "", transport, build, project: undefined };

  try {
    const version = await remoteVersion(transport, build.id);

    if (version !== build.version) {
      return notReady(
        version === null
          ? `Rowbly ${build.version} cannot run on the host.`
          : `The host has Rowbly ${version}; the main machine has ${build.version}.`,
      );
    }
  } catch (error) {
    if (!(error instanceof RowblyError)) {
      throw error;
    }

    return notReady(error.message);
  }

  const found = await hostProviders(env);

  if ("problem" in found) {
    return notReady(found.problem);
  }

  return found.providers.length === 0
    ? { ready: false, providers: [], problems: ["Pi has no configured provider on the host."] }
    : { ready: true, providers: found.providers, problems: [] };
}
