// The worker hosts of the factory: the hosts of the registry that the Project uses, with the state of their last
// check, and the connection of each host. The checks run in the background, so a call never waits for SSH.

import { ConflictError } from "../errors/errors.js";
import type { WorkerHostView } from "../factory-manager/host-slots.js";
import { type HostEntry, type HostProject, hostProjectRecord, rcHosts } from "../host/host-rules.js";
import { remoteRowblyPath } from "../host-install/host-install.js";
import { type LocalBuild, localBuild } from "../host-install/local-build.js";
import type { HostTransport } from "../host-transport/host-transport.js";
import { createSshTransport } from "../host-transport/ssh-transport.js";
import type { HostConnection } from "../remote-executor/remote-types.js";
import { Store, withEntry } from "../store/store.js";
import { rcPath, readRc } from "../user-rc/user-rc.js";
import { findProject, type ServiceContext } from "../workspace/workspace.js";
import { type ProbedHost, probeWorkerHost } from "./worker-host-probe.js";

/** The time between two checks of a host. */
export const DEFAULT_HOST_CHECK_INTERVAL_MS = 60_000;

/** The connection, the build and the clock of the source. Tests replace them. */
export interface WorkerHostDeps {
  readonly transportFor?: (target: string) => HostTransport;
  readonly build?: () => Promise<LocalBuild>;
  /** The clock. The default is the clock of the context, else the system time. */
  readonly now?: () => Date;
  readonly checkIntervalMs?: number;
}

/** The two manager dependencies of the worker hosts. */
export interface WorkerHostSource {
  /** Gives the last known view of each host that is on and that the Project uses. It starts the checks that are due. */
  readonly workerHosts: () => Promise<readonly WorkerHostView[]>;
  /** Gives the connection of a host that the Project uses, also when the host is off. */
  readonly hostConnection: (host: string) => Promise<HostConnection>;
  /** Waits for the checks that run now. */
  readonly settled: () => Promise<void>;
}

/** The last check of one host. `checkId` identifies the check that can write the record. */
interface HostRecord {
  readonly checkId: number;
  readonly running?: Promise<void>;
  /** The time in milliseconds at the end of the last completed check. */
  readonly checkedAt?: number;
  readonly result?: ProbedHost;
}

interface SourceState {
  readonly records: ReadonlyMap<string, HostRecord>;
  /** One transport for each SSH target, made at the first use. */
  readonly transports: ReadonlyMap<string, HostTransport>;
  readonly build?: Promise<LocalBuild>;
  readonly nextCheckId: number;
}

interface Source {
  readonly ctx: ServiceContext;
  readonly transportFor: (target: string) => HostTransport;
  readonly build: () => Promise<LocalBuild>;
  readonly now: () => Date;
  readonly intervalMs: number;
  readonly state: Store<SourceState>;
}

/** A registry host with the record of the current Project. */
interface ProjectHost {
  readonly host: HostEntry;
  readonly project: HostProject;
}

async function projectHosts(source: Source): Promise<ProjectHost[]> {
  const { root } = await findProject(source.ctx);
  const file = rcPath(source.ctx);
  const hosts = rcHosts(await readRc(file), file);

  return hosts.flatMap((host) => {
    const project = hostProjectRecord(host, root);

    return project ? [{ host, project }] : [];
  });
}

function forgetBuild(source: Source, build: Promise<LocalBuild>): void {
  source.state.update((state) => (state.build === build ? { build: undefined } : {}));
}

/** Gives the local build. It gets the build one time. After a failure, the next call tries again. */
function buildOf(source: Source): Promise<LocalBuild> {
  const known = source.state.current.build;

  if (known) {
    return known;
  }

  const build = source.build();

  source.state.update(() => ({ build }));
  build.catch(() => forgetBuild(source, build));

  return build;
}

function transportOf(source: Source, target: string): HostTransport {
  const known = source.state.current.transports.get(target);

  if (known) {
    return known;
  }

  const transport = source.transportFor(target);

  source.state.update((state) => ({ transports: withEntry(state.transports, target, transport) }));

  return transport;
}

function isDue(source: Source, id: string): boolean {
  const record = source.state.current.records.get(id);

  if (!record || record.checkedAt === undefined) {
    return !record?.running;
  }

  return !record.running && source.now().getTime() - record.checkedAt >= source.intervalMs;
}

/** Keeps the result of a check, if no newer check started and the host is still in the list. */
function finished(
  state: SourceState,
  id: string,
  checkId: number,
  result: ProbedHost,
  at: number,
): Partial<SourceState> {
  if (state.records.get(id)?.checkId !== checkId) {
    return {};
  }

  return { records: withEntry(state.records, id, { checkId, checkedAt: at, result }) };
}

async function runCheck(source: Source, host: HostEntry, checkId: number): Promise<void> {
  const result = await probeWorkerHost({
    transport: () => transportOf(source, host.ssh),
    build: () => buildOf(source),
  });
  const at = source.now().getTime();

  source.state.update((state) => finished(state, host.id, checkId, result, at));
}

function startCheck(source: Source, host: HostEntry): void {
  const { nextCheckId: checkId } = source.state.current;

  source.state.update((state) => ({
    nextCheckId: checkId + 1,
    records: withEntry(state.records, host.id, { ...state.records.get(host.id), checkId }),
  }));

  // The record has the new check id before the check can complete.
  const running = runCheck(source, host, checkId);

  source.state.update((state) => {
    const record = state.records.get(host.id);

    return record?.checkId === checkId ? { records: withEntry(state.records, host.id, { ...record, running }) } : {};
  });
}

/** Removes the records of the hosts that left the list. A host that comes back gets a new check. */
function keepRecords(source: Source, ids: ReadonlySet<string>): void {
  source.state.update((state) => ({
    records: new Map([...state.records].filter(([id]) => ids.has(id))),
  }));
}

function view(host: HostEntry, record: HostRecord | undefined): WorkerHostView {
  const result = record?.result ?? { state: "not-ready" };

  return {
    id: host.id,
    maxWorkers: host.maxWorkers,
    state: result.state,
    ...(result.providers ? { providers: result.providers } : {}),
  };
}

async function workerHosts(source: Source): Promise<readonly WorkerHostView[]> {
  const hosts = (await projectHosts(source)).map((entry) => entry.host).filter((host) => host.enabled);

  keepRecords(source, new Set(hosts.map((host) => host.id)));

  for (const host of hosts.filter((entry) => isDue(source, entry.id))) {
    startCheck(source, host);
  }

  const { records } = source.state.current;

  return hosts.map((host) => view(host, records.get(host.id)));
}

async function hostConnection(source: Source, id: string): Promise<HostConnection> {
  const found = (await projectHosts(source)).find((entry) => entry.host.id === id);

  if (!found) {
    throw new ConflictError(`Host "${id}" is not a worker host of this Project`, {
      hint: `Run \`rowbly host list\`, and \`rowbly host use ${id}\` in the Project.`,
    });
  }

  const build = await buildOf(source);

  return {
    transport: transportOf(source, found.host.ssh),
    rowbly: remoteRowblyPath(build.id),
    clone: found.project.path,
  };
}

async function settled(source: Source): Promise<void> {
  await Promise.all([...source.state.current.records.values()].map((record) => record.running));
}

/**
 * Makes the manager dependencies `workerHosts` and `hostConnection` from the host registry in `~/.rowblyrc.json`.
 * It only reads the file. It gets the local build and makes a transport only when a host needs them.
 */
export function createWorkerHostSource(ctx: ServiceContext = {}, deps: WorkerHostDeps = {}): WorkerHostSource {
  const source: Source = {
    ctx,
    transportFor: deps.transportFor ?? ((target) => createSshTransport({ target })),
    build: deps.build ?? localBuild,
    now: deps.now ?? ctx.now ?? (() => new Date()),
    intervalMs: deps.checkIntervalMs ?? DEFAULT_HOST_CHECK_INTERVAL_MS,
    state: new Store<SourceState>({ records: new Map(), transports: new Map(), nextCheckId: 0 }),
  };

  return {
    workerHosts: () => workerHosts(source),
    hostConnection: (host) => hostConnection(source, host),
    settled: () => settled(source),
  };
}
