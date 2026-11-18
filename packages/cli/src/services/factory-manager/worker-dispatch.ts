// The dispatch step of a factory pass. The manager starts a worker for each `start` and `retry` decision of the
// policy. No model makes a dispatch decision.
import { ConflictError } from "../errors/errors.js";
import type { PolicyDecision } from "../factory-policy/factory-policy.js";
import { mapInOrder } from "../in-order/in-order.js";
import { withoutEntry } from "../store/store.js";
import { getThread } from "../thread/thread.js";
import { failureText, type StepResult } from "./factory-steps.js";
import { getState, isActiveStatus, type Manager, serial, setState } from "./manager-state.js";
import { scan } from "./manager-status.js";
import { reserveWorker } from "./worker-reservation.js";

/** The label of the attention entry `dispatch`. */
const DISPATCH_LABEL = "Worker dispatch failed";

/** Tells if the decision starts a worker. */
function isLaunch(decision: PolicyDecision): boolean {
  return decision.action === "start" || decision.action === "retry";
}

/** The fixed request ID of one start: `<story-id>:<stage>:<attempt>`. A second pass cannot start the same work. */
function dispatchRequestId(decision: PolicyDecision): string {
  return `${decision.story}:${decision.stage}:${decision.attempt ?? 1}`;
}

/**
 * Reserves a worker for each `start` and `retry` decision, in the order of the policy decisions. A `ConflictError`
 * skips only its Story. A different error gives the text of the attention entry `dispatch`, and the step continues
 * with the next decision. A step with no error gives no text, so that the entry goes away.
 */
export async function dispatchWorkers(manager: Manager): Promise<StepResult> {
  const policy = await serial(manager, () => scan(manager));
  const failures = await mapInOrder(policy.decisions.filter(isLaunch), (decision) => dispatchOne(manager, decision));

  return failures.find((failure) => failure !== undefined);
}

/** Starts one worker. Gives the attention text of an error that is not a `ConflictError`, or undefined. */
async function dispatchOne(manager: Manager, decision: PolicyDecision): Promise<string | undefined> {
  if (getState(manager).stopping) {
    return undefined;
  }

  const requestId = dispatchRequestId(decision);

  try {
    await forgetFinishedRequest(manager, requestId);
    await reserveWorker(manager, { storyId: decision.story, stage: decision.stage, requestId });

    return undefined;
  } catch (error) {
    return error instanceof ConflictError ? undefined : failureText(`${DISPATCH_LABEL} for ${decision.story}`, error);
  }
}

/**
 * Forgets a request whose Thread is final. The policy counts the attempts of a Stage again after a budget reset, so
 * a new stay in the Stage can have the request ID of an earlier worker. An active Thread keeps its request.
 */
async function forgetFinishedRequest(manager: Manager, requestId: string): Promise<void> {
  const threadId = getState(manager).requests.get(requestId);

  if (!threadId || getState(manager).active.has(threadId)) {
    return;
  }

  const thread = await getThread(threadId, manager.ctx);

  if (isActiveStatus(thread.status)) {
    return;
  }

  setState(manager, (state) => ({ requests: withoutEntry(state.requests, requestId) }));
}
