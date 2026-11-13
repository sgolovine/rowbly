import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import { promisify } from "node:util";
import { ConflictError } from "../errors/errors.js";
import { assertFactoryOwnership } from "../factoryOwnership/factoryOwnership.js";
import { readFactoryState, updateFactoryState } from "../factoryState/factoryState.js";
import { runtimePath } from "../runtimeFiles/runtimeFiles.js";
import { getStory } from "../story/story.js";
import { listThreads, projectNativeAttempt, transitionThread } from "../thread/thread.js";
import { findProject, type ServiceContext } from "../workspace/workspace.js";

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
  if (external.length && adoptExternal)
    await updateFactoryState(
      paths.root,
      (current) => {
        for (const a of current.attempts)
          if (external.some((e) => e.workerId === a.workerId && e.story === a.story)) {
            a.status = "interrupted";
            a.stoppedAt = new Date().toISOString();
          }
        return current;
      },
      ctx,
    );
  // Exclusive ownership proves that all other native generations are abandoned.
  // Each durable transition and projection can repeat after another crash.
  for (const t of threads) {
    await assertFactoryOwnership(paths, token);
    if (["pending", "running"].includes(t.status) && t.runs.at(-1)?.ownerToken !== token) {
      const story = t.storyId ? await getStory({ id: t.storyId }, ctx).catch(() => undefined) : undefined;
      const exists =
        t.session.file &&
        (await stat(await runtimePath(paths, t.session.file)).then(
          (s) => s.isFile(),
          () => false,
        ));
      await transitionThread(
        t.id,
        {
          expectedRevision: t.revision,
          status: "interrupted",
          patch: {
            resumable: !!exists && t.role === "worker" && story?.stage === t.stage,
            error: { class: "unknown", code: "OWNER_DIED", message: "The previous factory owner stopped unexpectedly" },
          },
        },
        ctx,
      );
    }
    await projectNativeAttempt(t.id, ctx);
  }
  return { externalActive: adoptExternal ? 0 : external.length };
}

/** Checks execution prerequisites before loading credentials or Pi. */
export async function preflightFactory(ctx: ServiceContext = {}) {
  if (process.platform !== "linux")
    throw new ConflictError("Native factory execution requires Linux and util-linux flock");
  const paths = await findProject(ctx);
  const exec = promisify(execFile);
  try {
    await exec("flock", ["--version"]);
    await exec("git", ["-C", paths.root, "rev-parse", "--show-toplevel"]);
  } catch (cause) {
    throw new ConflictError("Native factory execution requires a Git Project and util-linux flock", { cause });
  }
}
