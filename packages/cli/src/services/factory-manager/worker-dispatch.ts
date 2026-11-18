// The dispatch step of a factory pass. The manager starts a worker for each `start` and `retry` decision of the
// policy. No model makes a dispatch decision.
import { ConflictError } from "../errors/errors.js";
import type { PolicyDecision } from "../factory-policy/factory-policy.js";
import { mapInOrder } from "../in-order/in-order.js";
import { withoutEntry } from "../store/store.js";
import { getThread } from "../thread/thread.js";
import { failureText, type StepResult } from "./factory-steps.js";
import { type DispatchRefusal, getState, isActiveStatus, type Manager, serial, setState } from "./manager-state.js";
import { scan } from "./manager-status.js";
import { reserveWorker } from "./worker-reservation.js";

/** The label of the attention entry `dispatch`. */
const DISPATCH_LABEL = "Worker dispatch failed";

/** The end of the dispatch of one decision: the attention text of an error, or the refusal of a `ConflictError`. */
interface DispatchOutcome {
  readonly failure?: string;
  readonly refusal?: readonly [string, DispatchRefusal];
}

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
 * skips only its Story, and the step keeps its message as the dispatch refusal of the Story. The status shows the
 * refusal as the skip reason of the Story. Each step replaces all refusals, so that a refusal goes away when a worker
 * starts or the decision changes. A different error gives the text of the attention entry `dispatch`, and the step
 * continues with the next decision. A step with no error gives no text, so that the entry goes away.
 */
export async function dispatchWorkers(manager: Manager): Promise<StepResult> {
  const policy = await serial(manager, () => scan(manager));
  const outcomes = await mapInOrder(policy.decisions.filter(isLaunch), (decision) => dispatchOne(manager, decision));
  const refusals = outcomes.flatMap((outcome) => (outcome.refusal ? [outcome.refusal] : []));

  setState(manager, () => ({ dispatchRefusals: new Map(refusals) }));

  return outcomes.find((outcome) => outcome.failure !== undefined)?.failure;
}

/** Starts one worker. Gives the refusal of a `ConflictError`, or the attention text of a different error. */
async function dispatchOne(manager: Manager, decision: PolicyDecision): Promise<DispatchOutcome> {
  if (getState(manager).stopping) {
    return {};
  }

  const requestId = dispatchRequestId(decision);

  try {
    await forgetFinishedRequest(manager, requestId);
    assertNewRequest(manager, requestId);
    await reserveWorker(manager, { storyId: decision.story, stage: decision.stage, requestId });

    return {};
  } catch (error) {
    return error instanceof ConflictError
      ? { refusal: [decision.story, refusalOf(decision, error)] }
      : { failure: failureText(`${DISPATCH_LABEL} for ${decision.story}`, error) };
  }
}

/** The refusal of the dispatch of a decision, with the facts that identify the decision. */
function refusalOf(decision: PolicyDecision, error: ConflictError): DispatchRefusal {
  return { stage: decision.stage, action: decision.action, attempt: decision.attempt, message: error.message };
}

/**
 * Refuses a request that still has a worker Thread. A reservation gives the Thread of an earlier request with the same
 * ID and starts no worker, so a dispatch of the same request again cannot start a worker.
 */
function assertNewRequest(manager: Manager, requestId: string): void {
  const threadId = getState(manager).requests.get(requestId);

  if (threadId) {
    throw new ConflictError(`The earlier worker ${threadId} of request ${requestId} has not ended`);
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
