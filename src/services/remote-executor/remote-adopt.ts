// The adoption of the remote runs that a previous daemon started: the first state of an adopted run, and the
// `host runs` step of the reconnect that gives each adopted run its command id.

import type { HostRunState } from "../host-agent/host-run-state.js";
import { mapInOrder } from "../in-order/in-order.js";
import type { ThreadRecord } from "../thread/thread-types.js";
import { type CallTarget, runStates } from "./remote-calls.js";
import { hooksOf, queuedCommands } from "./remote-commands.js";
import { failRun, takeRunFrame } from "./remote-run.js";
import { openRuns } from "./remote-sync.js";
import type { AdoptedFacts, RemoteEnv, RemoteRun, RemoteRunState } from "./remote-types.js";
import { RemoteRunError } from "./run-frames.js";

/** The error code of an adopted Thread whose run is not on its host and not in the queue of its host. */
export const HOST_RUN_MISSING = "HOST_RUN_MISSING";

/** True when the run is adopted and has no command id yet. The reconnect asks the host for its run. */
export function needsRunState(run: RemoteRun): boolean {
  const { adopted, commandId, closed } = run.store.current;

  return !!adopted && !commandId && !closed;
}

/**
 * Gives the first state of an adopted run. A queued `launch` or `resume` of the Thread gives the command id, because
 * the host does not have that run before the queue is sent.
 */
export async function adoptedRunState(
  env: RemoteEnv,
  host: string,
  thread: ThreadRecord,
): Promise<Partial<RemoteRunState>> {
  const adopted: AdoptedFacts = { worktree: !!thread.worktree, session: !!thread.session.file };
  const queued = (await queuedCommands(env, host)).find(
    (command) => command.threadId === thread.id && (command.type === "launch" || command.type === "resume"),
  );

  return queued ? { adopted, commandId: queued.id, launchQueued: true } : { adopted };
}

/** Gives the sent values of the facts that the Thread record already has, so that their events do not repeat. */
function knownValues(adopted: AdoptedFacts | undefined, state: HostRunState): Partial<RemoteRunState> {
  const worktree = adopted?.worktree && state.worktree ? { worktree: JSON.stringify(state.worktree) } : {};
  const session = adopted?.session && state.session ? { session: JSON.stringify(state.session) } : {};

  return { commandId: state.requestId, sent: { ...worktree, ...session }, sessionOpened: !!adopted?.session };
}

/** Gives the run state of the host to an adopted run. A run that the host does not have fails. */
async function takeRunState(env: RemoteEnv, run: RemoteRun, state: HostRunState | undefined): Promise<void> {
  if (!state) {
    const error = new RemoteRunError(HOST_RUN_MISSING, `Host ${run.host} has no run of Thread ${run.threadId}`);

    await failRun(run, { error, sessionOpened: false });

    return;
  }

  run.store.update((current) => knownValues(current.adopted, state));
  takeRunFrame(run, state, hooksOf(env));
}

/**
 * Asks the host for the run of each adopted run without a command id. A transport error throws, and the runs stay
 * adopted for the next reconnect.
 */
export async function askAdoptedRuns(env: RemoteEnv, target: CallTarget, host: string): Promise<void> {
  const runs = openRuns(env, host).filter(needsRunState);

  if (runs.length === 0) {
    return;
  }

  const states = await runStates(
    target,
    runs.map((run) => run.threadId),
  );

  await mapInOrder(runs, (run) =>
    takeRunState(
      env,
      run,
      states.find((state) => state.threadId === run.threadId),
    ),
  );
}
