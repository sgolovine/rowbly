// The answer of `rowbly host runs`: the run state of each Thread that the main machine asks for. It starts nothing.

import { ValidationError } from "../errors/errors.js";
import { mapInOrder } from "../in-order/in-order.js";
import { type HostAgentPaths, validateThreadId } from "./host-agent-paths.js";
import { type HostRunState, readHostRun } from "./host-run-state.js";

/** The maximum number of Thread ids in one request. */
const MAX_THREAD_IDS = 1000;

/** The answer of `rowbly host runs`. A Thread without a run state on this host is not in the list. */
export interface HostRunsAnswer {
  readonly runs: readonly HostRunState[];
}

/** Gives the Thread ids of the input, or throws a ValidationError. */
function threadIdsOf(input: unknown): string[] {
  const ids = (input as { threadIds?: unknown } | null)?.threadIds;

  if (!Array.isArray(ids) || ids.length > MAX_THREAD_IDS) {
    throw new ValidationError(`The input must have a list of at most ${MAX_THREAD_IDS} Thread ids`);
  }

  return [...new Set(ids.map((id) => validateThreadId(id)))];
}

/** Gives the run state of each requested Thread that has one on this host. */
export async function hostRuns(paths: HostAgentPaths, input: unknown): Promise<HostRunsAnswer> {
  const states = await mapInOrder(threadIdsOf(input), (threadId) => readHostRun(paths, threadId));

  return { runs: states.filter((state): state is HostRunState => state !== undefined) };
}
