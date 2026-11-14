import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import { promisify } from "node:util";
import { stopOrphanChecks } from "../check-queue/check-orphans.js";
import { ConflictError } from "../errors/errors.js";
import { assertFactoryOwnership } from "../factory-ownership/factory-ownership.js";
import type { PolicyAttempt, PolicyState } from "../factory-policy/factory-policy.js";
import { assertNoLegacyFactorySettings } from "../factory-settings/factory-settings.js";
import { readFactoryState, updateFactoryState } from "../factory-state/factory-state.js";
import { mapInOrder } from "../in-order/in-order.js";
import { runtimePath } from "../runtime-files/runtime-files.js";
import { getStory } from "../story/story.js";
import { listThreads, projectNativeAttempt, type ThreadRecord, transitionThread } from "../thread/thread.js";
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
async function interruptThread(paths: ProjectPaths, thread: ThreadRecord, ctx: ServiceContext): Promise<void> {
  const story = thread.storyId ? await getStory({ id: thread.storyId }, ctx).catch(() => undefined) : undefined;
  const exists = await sessionFileExists(paths, thread);

  await transitionThread(
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

/** Checks the ownership again, interrupts the Thread of a dead owner and repairs its projection. */
async function recoverThread(
  paths: ProjectPaths,
  token: string,
  thread: ThreadRecord,
  ctx: ServiceContext,
): Promise<void> {
  await assertFactoryOwnership(paths, token);

  if (["pending", "running"].includes(thread.status) && thread.runs.at(-1)?.ownerToken !== token) {
    await interruptThread(paths, thread, ctx);
  }

  await projectNativeAttempt(thread.id, ctx);
}

/** Recovery runs only under new ownership, before any supervisor session opens. */
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

  if (external.length && adoptExternal) {
    await updateFactoryState(paths.root, (current) => interruptExternal(current, external), ctx);
  }

  // Exclusive ownership proves that all other native generations are abandoned.
  // Each durable transition and projection can repeat after another crash.
  await mapInOrder(threads, (thread) => recoverThread(paths, token, thread, ctx));
  await stopOrphanChecks(paths, token);

  return { externalActive: adoptExternal ? 0 : external.length };
}

/** Checks execution prerequisites before loading credentials or Pi. */
export async function preflightFactory(ctx: ServiceContext = {}) {
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
