import type { AttemptStatus, PolicyAttempt, PolicyState } from "../factory-policy/factory-policy.js";
import { updateFactoryState } from "../factory-state/factory-state.js";
import { findProject, type ServiceContext } from "../workspace/workspace.js";
import { getThread } from "./thread-files.js";
import type { ThreadRecord, ThreadStatus } from "./thread-types.js";

function attemptStatus(status: ThreadStatus): AttemptStatus {
  if (status === "pending") {
    return "preparing";
  }

  if (status === "cancelled") {
    return "interrupted";
  }

  return status;
}

/** Gives the attempt of a worker Thread with the fields that follow the Thread. */
function projectedAttempt(
  t: ThreadRecord,
  existing: PolicyAttempt | undefined,
  story: string,
  stage: string,
): PolicyAttempt {
  const base: PolicyAttempt = existing ?? {
    story,
    stage,
    workerId: t.id,
    threadId: t.id,
    status: "preparing",
    startReported: false,
  };

  return {
    ...base,
    status: attemptStatus(t.status),
    model: t.model ? `${t.model.provider}/${t.model.modelId}` : undefined,
    startedAt: t.startedAt ?? t.createdAt,
    stoppedAt: t.completedAt ?? null,
    ...(t.result ? { result: t.result } : {}),
  };
}

async function projectedState(id: string, state: PolicyState, ctx: ServiceContext): Promise<PolicyState> {
  const t = await getThread(id, ctx);

  if (t.role !== "worker" || !t.storyId || !t.stage) {
    return state;
  }

  const existing = state.attempts.find((attempt) => attempt.threadId === t.id);
  const attempt = projectedAttempt(t, existing, t.storyId, t.stage);
  const attempts = existing
    ? state.attempts.map((current) => (current === existing ? attempt : current))
    : [...state.attempts, attempt];

  return { ...state, attempts };
}

/** Repairs the second half of a durable intent transaction without duplicate attempts. */
export async function projectNativeAttempt(id: string, ctx: ServiceContext = {}): Promise<void> {
  const paths = await findProject(ctx);

  await updateFactoryState(paths.root, (state) => projectedState(id, state, ctx), ctx);
}
