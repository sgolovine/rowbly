// The shared types of the remote executor: the connection of a host, the input, and the state of each run and host.

import type { WorkerEvents, WorkerExecutor, WorkerLaunch } from "../factory-manager/worker-executor.js";
import type { ModelChoice } from "../factory-settings/factory-settings.js";
import type { HostRunState } from "../host-agent/host-run-state.js";
import type { HostChannel, HostTransport } from "../host-transport/host-transport.js";
import type { Store } from "../store/store.js";
import type { ProjectPaths, ServiceContext } from "../workspace/workspace.js";
import type { SentValues } from "./run-frames.js";

/** The connection of the main machine to one worker host for this Project. */
export interface HostConnection {
  readonly transport: HostTransport;
  /** The absolute path of `rowbly` on the host. */
  readonly rowbly: string;
  /** The clone of the Project on the host. A relative path is relative to the home folder of the host user. */
  readonly clone: string;
}

/** The dependencies of the remote executor. It gets no full manager. */
export interface RemoteExecutorInput {
  /** The paths of the Project on the main machine. The base of each copy goes below `runtimeDir`. */
  readonly paths: ProjectPaths;
  readonly ctx: ServiceContext;
  /** The project id of the host agent, from `hostProjectId(root)`. */
  readonly projectId: string;
  /** Gives the connection of a worker host. */
  readonly connect: (host: string) => Promise<HostConnection>;
  /** Gives the machine limit of a worker host, for `host serve --detach`. */
  readonly maxWorkers: (host: string) => number;
  /** Gives the model of a launch: the model of the Thread, else the worker model of the factory settings. */
  readonly model: (launch: WorkerLaunch) => ModelChoice | undefined;
  /** Applies all outbox entries of the host to the canonical files. Throws when the apply cannot complete. */
  readonly sync: (host: string) => Promise<void>;
  /** The time that a channel waits for the hello frame of the host. */
  readonly helloTimeoutMs?: number;

  // Abandoned Threads
  /** Records that a cancel of the Thread did not reach its host. The manager makes the Thread abandoned. */
  readonly abandon?: (threadId: string, host: string) => Promise<void>;
  /** Gives the abandoned remote Threads that have no remote outcome. */
  readonly abandoned?: () => Promise<readonly AbandonedThread[]>;
  /** Writes the remote outcome of an abandoned Thread from the last run frame. The status of the Thread stays. */
  readonly outcome?: (threadId: string, run: HostRunState) => Promise<void>;
}

/** One abandoned remote Thread that waits for its remote outcome. */
export interface AbandonedThread {
  readonly threadId: string;
  readonly host: string;
}

/** The remote executor. The manager also calls `syncHosts` at each scan. */
export interface RemoteExecutor extends WorkerExecutor {
  /**
   * Applies the outbox of each host with an active remote run, then ends the runs that wait for the sync. Gives the
   * problem of each host whose sync failed.
   */
  readonly syncHosts: () => Promise<ReadonlyMap<string, string>>;
  /**
   * Does the reconnect steps of a host whose heartbeat succeeded: sends the queued commands, opens the channel again
   * for the active runs, and applies the outbox. Gives the problem of a step that failed.
   */
  readonly reconnect: (host: string) => Promise<string | undefined>;
  /**
   * Stops each active run for a factory stop. A run on a host with an open channel ends normally, with a time limit.
   * For a host without a channel, `stop-thread` goes in the queue and the wait of the run ends.
   */
  readonly shutdown: (timeoutMs?: number) => Promise<void>;
}

/** The short-lived state of one remote run, from the launch to the end of its wait. */
export interface RemoteRunState {
  /** The id of the `launch` or `resume` command. Only the frames of this command belong to the run. */
  readonly commandId?: string;
  readonly sent: SentValues;
  /** The manager wrote the session of the run. Until then, the scan sync does not apply the outbox of the host. */
  readonly sessionOpened: boolean;
  /** The last run frame, after the run ended on the host. The run waits for the outbox sync. */
  readonly ended?: HostRunState;
  /** A stop or a cancel of the manager. The launch command does not go to the host after it. */
  readonly stopRequested?: "stop" | "cancel";
  /** The `launch` or `resume` command is in the queue of the host, because its submit failed in the transport. */
  readonly launchQueued?: boolean;
  /** The run sent its last event, or its wait ended. Later frames do nothing. */
  readonly closed: boolean;
  /** The frames of the run, one at a time. */
  readonly chain: Promise<void>;
}

/** One remote run. `done` aborts when the launch can resolve. */
export interface RemoteRun {
  readonly threadId: string;
  readonly host: string;
  readonly events: WorkerEvents;
  readonly store: Store<RemoteRunState>;
  readonly done: AbortController;
}

/** The `host attach` channel of one host. `closed` aborts when the channel closes. */
export interface HostLink {
  readonly opened: Promise<HostChannel>;
  readonly closed: AbortController;
  /** The connection of the host. The attachment uploads of the channel use it. */
  readonly connection: HostConnection;
  /** The attachment ids with an upload in progress. */
  readonly fetching: Store<{ readonly ids: ReadonlySet<string> }>;
}

/** The runs and the channels of the executor. */
export interface RemoteState {
  readonly runs: ReadonlyMap<string, RemoteRun>;
  readonly links: ReadonlyMap<string, HostLink>;
  /** The changes of the queue files, one at a time. */
  readonly queueChain: Promise<void>;
  /** The reconnect of each host that runs now. */
  readonly reconnects: ReadonlyMap<string, Promise<string | undefined>>;
  /** The last run frame of each abandoned Thread, until the outbox sync of its host. The key is the Thread id. */
  readonly outcomes: ReadonlyMap<string, { readonly host: string; readonly frame: HostRunState }>;
}

/** The fixed environment of the remote executor, and the store of its runs and channels. */
export interface RemoteEnv {
  readonly input: RemoteExecutorInput;
  readonly state: Store<RemoteState>;
}
