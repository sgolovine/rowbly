import type { AttemptStatus, PolicyAttempt, PolicyState } from "../factory-policy/factory-policy.js";
import { updateFactoryState } from "../factory-state/factory-state.js";
import { findProject, type ServiceContext } from "../workspace/workspace.js";
import { getThread } from "./thread-files.js";
import { LOCAL_HOST, type ThreadRecord, type ThreadStatus } from "./thread-types.js";

/** The state after a projection, and true when the projection changed or added an attempt. */
export interface ProjectedAttempts {
  readonly state: PolicyState;
  readonly changed: boolean;
}

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
    ...(t.storyUid === undefined ? {} : { storyUid: t.storyUid }),
    stage,
    workerId: t.id,
    threadId: t.id,
    status: "preparing",
    startReported: false,
  };

  return {
    ...base,
    status: attemptStatus(t.status),
    host: t.host ?? LOCAL_HOST,
    model: t.model ? `${t.model.provider}/${t.model.modelId}` : undefined,
    startedAt: t.startedAt ?? t.createdAt,
    stoppedAt: t.completedAt ?? null,
    ...(t.result ? { result: t.result } : {}),
  };
}

/** True when the two attempts have the same field values. A missing key and an `undefined` value are equal. */
function sameAttempt(a: PolicyAttempt, b: PolicyAttempt): boolean {
  const left: Record<string, unknown> = { ...a };
  const right: Record<string, unknown> = { ...b };
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);

  return [...keys].every((key) => JSON.stringify(left[key]) === JSON.stringify(right[key]));
}

/** Gives the first attempt of each Thread ID, as `Array.find` does. */
function attemptsByThread(attempts: readonly PolicyAttempt[]): ReadonlyMap<string, PolicyAttempt> {
  return new Map(
    attempts.toReversed().flatMap((attempt) => (attempt.threadId ? [[attempt.threadId, attempt] as const] : [])),
  );
}

function isProjected(t: ThreadRecord): t is ThreadRecord & { storyId: string; stage: string } {
  return t.role === "worker" && !!t.storyId && !!t.stage;
}

/**
 * Replaces the attempt of each worker Thread by its Thread ID, or appends a new attempt. Other attempts and other
 * Threads do not change. This pure function is O(n), and it is safe to apply again.
 */
export function projectAttempts(state: PolicyState, threads: readonly ThreadRecord[]): ProjectedAttempts {
  const existing = attemptsByThread(state.attempts);
  const projected = new Map(
    threads.filter(isProjected).map((t) => [t.id, projectedAttempt(t, existing.get(t.id), t.storyId, t.stage)]),
  );
  const replaced = state.attempts.map((attempt) =>
    attempt.threadId && existing.get(attempt.threadId) === attempt
      ? (projected.get(attempt.threadId) ?? attempt)
      : attempt,
  );
  const appended = [...projected.entries()].filter(([id]) => !existing.has(id)).map(([, attempt]) => attempt);
  const changed =
    appended.length > 0 ||
    replaced.some((attempt, index) => !sameAttempt(attempt, state.attempts[index] as PolicyAttempt));

  return changed ? { state: { ...state, attempts: [...replaced, ...appended] }, changed } : { state, changed };
}

async function projectedState(id: string, state: PolicyState, ctx: ServiceContext): Promise<PolicyState> {
  return projectAttempts(state, [await getThread(id, ctx)]).state;
}

/** Repairs the second half of a durable intent transaction without duplicate attempts. */
export async function projectNativeAttempt(id: string, ctx: ServiceContext = {}): Promise<void> {
  const paths = await findProject(ctx);

  await updateFactoryState(paths.root, (state) => projectedState(id, state, ctx), ctx);
}
