import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import { promisify } from "node:util";
import { stopOrphanChecks } from "../check-queue/check-orphans.js";
import { ConflictError } from "../errors/errors.js";
import { assertFactoryOwnership } from "../factory-ownership/factory-ownership.js";
import type { PolicyAttempt, PolicyState } from "../factory-policy/factory-policy.js";
import { assertNoLegacyFactorySettings } from "../factory-settings/factory-settings.js";
import { readFactoryState, updateFactoryStateIfChanged } from "../factory-state/factory-state.js";
import { mapInOrder } from "../in-order/in-order.js";
import { refuseRemoteWrite } from "../outbox/outbox.js";
import { runtimePath } from "../runtime-files/runtime-files.js";
import { getStory } from "../story/story.js";
import { LOCAL_HOST, listThreads, projectAttempts, type ThreadRecord, transitionThread } from "../thread/thread.js";
import { findProject, type ProjectPaths, type ServiceContext } from "../workspace/workspace.js";

/** Marks the adopted external attempts interrupted. All other attempts stay the same. */
function interruptExternal(current: PolicyState, external: readonly PolicyAttempt[]): PolicyState {
  const attempts = current.attempts.map((a) =>
    external.some((e) => e.workerId === a.workerId && e.story === a.story)
      ? { ...a, status: "interrupted" as const, stoppedAt: new Date().toISOString() }
      : a,
  );

  return { ...current, attempts };
}

async function sessionFileExists(paths: ProjectPaths, thread: ThreadRecord): Promise<boolean> {
  if (!thread.session.file) {
    return false;
  }

  return stat(await runtimePath(paths, thread.session.file)).then(
    (s) => s.isFile(),
    () => false,
  );
}

/** Interrupts an active Thread of a dead owner. Only a worker with its session and Stage can resume. */
async function interruptThread(paths: ProjectPaths, thread: ThreadRecord, ctx: ServiceContext): Promise<ThreadRecord> {
  const story = thread.storyId ? await getStory({ id: thread.storyId }, ctx).catch(() => undefined) : undefined;
  const exists = await sessionFileExists(paths, thread);

  return transitionThread(
    thread.id,
    {
      expectedRevision: thread.revision,
      status: "interrupted",
      patch: {
        resumable: exists && thread.role === "worker" && story?.stage === thread.stage,
        error: { class: "unknown", code: "OWNER_DIED", message: "The previous factory owner stopped unexpectedly" },
      },
    },
    ctx,
  );
}

/** True when the Thread runs on a worker host. Its run can continue on the host after the owner died. */
function isRemote(thread: ThreadRecord): boolean {
  return !!thread.host && thread.host !== LOCAL_HOST;
}

/** True when the Thread is an active local run of a different owner. */
function isOrphan(token: string, thread: ThreadRecord): boolean {
  return (
    ["pending", "running"].includes(thread.status) && thread.runs.at(-1)?.ownerToken !== token && !isRemote(thread)
  );
}

/**
 * Checks the ownership again and interrupts the Thread of a dead owner. Gives the current record of the Thread. A
 * Thread on a worker host keeps its status: the new manager adopts its run.
 */
async function recoverThread(
  paths: ProjectPaths,
  token: string,
  thread: ThreadRecord,
  ctx: ServiceContext,
): Promise<ThreadRecord> {
  if (!isOrphan(token, thread)) {
    return thread;
  }

  await assertFactoryOwnership(paths, token);

  return interruptThread(paths, thread, ctx);
}

/** Gives the recovered state, or `undefined` when no attempt changed. */
function recoveredState(
  state: PolicyState,
  threads: readonly ThreadRecord[],
  external: readonly PolicyAttempt[],
): PolicyState | undefined {
  const adopted = external.length ? interruptExternal(state, external) : state;
  const projected = projectAttempts(adopted, threads);

  return projected.changed || adopted !== state ? projected.state : undefined;
}

/**
 * Repairs the projections of all Threads and adopts the external attempts in one state write. The ownership check is
 * under the state lock. When no attempt changes, the file stays the same.
 */
async function writeRecoveredState(
  paths: ProjectPaths,
  token: string,
  threads: readonly ThreadRecord[],
  external: readonly PolicyAttempt[],
  ctx: ServiceContext,
): Promise<boolean> {
  return updateFactoryStateIfChanged(
    paths.root,
    async (state) => {
      await assertFactoryOwnership(paths, token);

      return recoveredState(state, threads, external);
    },
    ctx,
  );
}

/** Recovery runs only under new ownership, before the first factory pass. */
export async function recoverFactory(
  token: string,
  _deadToken: string | undefined,
  adoptExternal: boolean,
  ctx: ServiceContext,
) {
  const paths = await findProject(ctx);

  await assertFactoryOwnership(paths, token);

  const { threads } = await listThreads({}, ctx);
  const state = await readFactoryState(paths.root, ctx);
  const external = state.attempts.filter(
    (a) => ["preparing", "running"].includes(a.status) && !threads.some((t) => t.id === a.threadId),
  );

  // Exclusive ownership proves that all other native generations are abandoned.
  // Each durable transition and the one atomic projection write can repeat after another crash.
  const recovered = await mapInOrder(threads, (thread) => recoverThread(paths, token, thread, ctx));

  await writeRecoveredState(paths, token, recovered, adoptExternal ? external : [], ctx);
  await stopOrphanChecks(paths, token);

  return { externalActive: adoptExternal ? 0 : external.length };
}

/** Checks execution prerequisites before loading credentials or Pi. */
export async function preflightFactory(ctx: ServiceContext = {}) {
  refuseRemoteWrite(ctx, "run the factory");

  if (process.platform !== "linux") {
    throw new ConflictError("Native factory execution requires Linux and util-linux flock");
  }

  const paths = await findProject(ctx);
  const exec = promisify(execFile);

  try {
    await exec("flock", ["--version"]);
    await exec("git", ["-C", paths.root, "rev-parse", "--show-toplevel"]);
  } catch (cause) {
    throw new ConflictError("Native factory execution requires a Git Project and util-linux flock", { cause });
  }

  await assertNoLegacyFactorySettings(paths);
}
