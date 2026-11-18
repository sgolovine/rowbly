import { type CheckJob, type CheckQueue, createCheckQueue, submitCheck } from "../check-queue/check-queue.js";
import { realCheckDeps } from "../check-queue/proc-readers.js";
import { threadCheck, withCheck } from "../check-queue/thread-checks.js";
import { type CheckSpec, checkLimits } from "../factory-settings/check-settings.js";
import type { FactorySettings } from "../factory-settings/factory-settings.js";
import { type CheckCall, createCheckTool } from "../factory-worker/check-tool.js";
import { workerShellEnv } from "../factory-worker/worker-env.js";
import { listStages } from "../stage/stage.js";
import { getThread, type ThreadRecord } from "../thread/thread.js";
import type { ProjectPaths, ServiceContext } from "../workspace/workspace.js";
import { changeThread, getState, type Manager, serial } from "./manager-state.js";
import { persistStatus } from "./manager-status.js";

type CheckTool = ReturnType<typeof createCheckTool>;

/** The check tools of one worker, and the checks that its bash tool rejects. */
interface WorkerChecks {
  readonly tools: CheckTool[];
  readonly checks: readonly CheckSpec[];
}

/** The environment of the check tools of a worker. The worker executor gets it at construction. */
export interface CheckToolInput {
  readonly queue: CheckQueue;
  readonly ctx: ServiceContext;
  readonly root: string;
  readonly shim: string;
  readonly settings: () => FactorySettings;
  /** Extra variables of the check shell, as in the worker shell. A remote worker gives its outbox variables. */
  readonly env?: Readonly<Record<string, string>>;
}

/** Makes the check queue of a manager. The manager gives the settings and gets each change. */
export function openCheckQueue(
  paths: ProjectPaths,
  ownerToken: string,
  managerRef: () => Manager,
  deps = realCheckDeps(),
): Promise<CheckQueue> {
  return createCheckQueue({
    paths,
    ownerToken,
    deps,
    limits: () => checkLimits(getState(managerRef()).settings.checks),
    onChange: (job) => recordCheck(managerRef(), job),
  });
}

/** Gives the configured checks. Without a `checks` section or items, a worker gets no check tool. */
export function configuredChecks(manager: Manager): readonly CheckSpec[] {
  return settingsChecks(getState(manager).settings);
}

function settingsChecks(settings: FactorySettings): readonly CheckSpec[] {
  return checkLimits(settings.checks)?.items ?? [];
}

/** Gives the `run_check` tool of a worker, and the checks that its bash tool rejects. */
export function workerChecks(input: CheckToolInput, intent: ThreadRecord, worktree: string): WorkerChecks {
  const checks = settingsChecks(input.settings());

  if (!checks.length) {
    return { tools: [], checks: [] };
  }

  const tool = createCheckTool(checks, worktree, (call, signal, onProgress) =>
    runCheck(input, { intent, worktree, call }, { signal, onProgress }),
  );

  return { tools: [tool], checks };
}

async function runCheck(
  input: CheckToolInput,
  request: { readonly intent: ThreadRecord; readonly worktree: string; readonly call: CheckCall },
  options: { readonly signal?: AbortSignal; readonly onProgress: (text: string) => void },
) {
  const { intent, worktree, call } = request;
  const stages = await listStages(input.ctx);

  return submitCheck(
    input.queue,
    {
      threadId: intent.id,
      storyId: intent.storyId as string,
      stage: intent.stage as string,
      rank: stages.findIndex((stage) => stage.key === intent.stage),
      key: call.spec.key,
      scope: call.scope,
      files: call.files,
      command: call.command,
      cwd: worktree,
      env: workerShellEnv({ root: input.root, shim: input.shim, env: input.env }, process.env),
      memoryMb: call.spec.memoryMb,
      timeoutMinutes: call.spec.timeoutMinutes,
    },
    options,
  );
}

async function writeThreadCheck(manager: Manager, job: CheckJob): Promise<void> {
  const thread = await getThread(job.threadId, manager.ctx);

  await changeThread(manager, thread.id, thread.status, {
    checks: withCheck(thread.checks ?? [], threadCheck(job, manager.checks.deps.now())),
  });
  await persistStatus(manager);
}

/** Writes a job change to the Thread metadata and to `status.json`. A failed write waits for the next change. */
function recordCheck(manager: Manager, job: CheckJob): void {
  void serial(manager, () => writeThreadCheck(manager, job)).catch(() => {});
}
