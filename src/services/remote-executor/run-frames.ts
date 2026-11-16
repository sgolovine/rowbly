// Maps the run state of a host (`HostRunState` of a `run` frame) to the worker events of the manager. No I/O.

import { RowblyError } from "../errors/errors.js";
import type {
  WorkerActivity,
  WorkerFailure,
  WorkerSession,
  WorkerUsage,
  WorkerWorktree,
} from "../factory-manager/worker-executor.js";
import type { HostReceipt } from "../host-agent/host-agent-control.js";
import type { HostRunState } from "../host-agent/host-run-state.js";
import type { WorkerResult } from "../thread/thread.js";

/** The error of a remote run that failed on the host. It keeps the error code of the host. */
export class RemoteRunError extends RowblyError {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message, { details: { hostCode: code } });
    this.code = code;
  }
}

/** The last values that the manager got for a run, as JSON text. A frame that repeats a value sends no event. */
export interface SentValues {
  readonly worktree?: string;
  readonly session?: string;
  readonly activity?: string;
  readonly result?: string;
}

/** One new value of a run, in the order of the events. */
export type RunFact =
  | { readonly kind: "worktree"; readonly worktree: WorkerWorktree }
  | { readonly kind: "session"; readonly session: WorkerSession }
  | { readonly kind: "activity"; readonly activity: WorkerActivity }
  | { readonly kind: "result"; readonly result: WorkerResult };

/** The end of a run: a completion with the result and the stop reason, or a failure. */
export type RunEnd =
  | { readonly kind: "completed"; readonly result?: WorkerResult; readonly stop?: "stopped" | "cancelled" }
  | { readonly kind: "failed"; readonly failure: WorkerFailure };

const ZERO_USAGE: WorkerUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };

/** Gives the fact of one value, or nothing when the value is absent or the same as the sent value. */
function factOf(sent: SentValues, run: HostRunState, kind: RunFact["kind"]): RunFact[] {
  const value = run[kind];

  if (value === undefined || JSON.stringify(value) === sent[kind]) {
    return [];
  }

  return [{ kind, [kind]: value } as RunFact];
}

/** Gives the new values of a run frame, and the sent values after them. */
export function newFacts(sent: SentValues, run: HostRunState): { sent: SentValues; facts: RunFact[] } {
  const kinds: RunFact["kind"][] = ["worktree", "session", "activity", "result"];
  const facts = kinds.flatMap((kind) => factOf(sent, run, kind));
  const changed = Object.fromEntries(facts.map((fact) => [fact.kind, JSON.stringify(run[fact.kind])]));

  return { sent: { ...sent, ...changed }, facts };
}

/** True when the run ended on the host. */
export function hasEnded(run: HostRunState): boolean {
  return run.phase === "ended";
}

/** Gives the end of a run that ended. `stopped` and `cancelled` are completions with the stop reason. */
export function runEnd(run: HostRunState): RunEnd {
  if (run.endReason === "failed") {
    const failure = run.failure ?? {
      code: "WORKER_FAILED",
      message: "The worker failed on the host",
      sessionOpened: false,
    };

    return {
      kind: "failed",
      failure: {
        error: new RemoteRunError(failure.code, failure.message),
        sessionOpened: failure.sessionOpened || !!run.session,
      },
    };
  }

  const stop = run.endReason === "stopped" || run.endReason === "cancelled" ? run.endReason : undefined;

  return { kind: "completed", ...(run.result ? { result: run.result } : {}), ...(stop ? { stop } : {}) };
}

/** Gives the final activity and usage of a run with a session, or undefined for a run without a session. */
export function finalActivity(run: HostRunState): WorkerActivity | undefined {
  if (!run.session) {
    return undefined;
  }

  const lastTool = run.activity?.lastTool;

  return {
    lastActivityAt: run.activity?.lastActivityAt ?? run.endedAt ?? run.updatedAt,
    ...(lastTool ? { lastTool } : {}),
    usage: run.usage ?? run.activity?.usage ?? ZERO_USAGE,
  };
}

/** Gives the failure of a rejected receipt, or undefined for a receipt that is not rejected. */
export function receiptFailure(receipt: HostReceipt): WorkerFailure | undefined {
  if (receipt.status !== "rejected") {
    return undefined;
  }

  const code = receipt.error?.code ?? "COMMAND_REJECTED";
  const message = receipt.error?.message ?? "The host rejected the command";

  return { error: new RemoteRunError(code, message), sessionOpened: false };
}
