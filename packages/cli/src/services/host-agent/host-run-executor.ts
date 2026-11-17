import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import type { CheckQueue } from "../check-queue/check-types.js";
import { createLocalExecutor } from "../factory-manager/local-executor.js";
import type { WorkerExecutor } from "../factory-manager/worker-executor.js";
import type { FactorySettings } from "../factory-settings/factory-settings.js";
import { createFactoryRuntime } from "../pi-runtime/factory-runtime.js";

/** The Pi runtime and the Pi agent folder of the workers. */
export interface HostPiRuntime {
  readonly runtime: ModelRuntime;
  readonly agentDir: string;
}

/** The input of the executor of one remote run. */
export interface RunExecutorInput {
  /** The copy root. It goes to `ROWBLY_ROOT` of the worker shell. */
  readonly copy: string;
  /** The Git root of the worktrees. */
  readonly clone: string;
  /** The runtime folder of the host agent. The session files go below it, not below the clone. */
  readonly runtimeDir: string;
  readonly shim: string;
  /** The outbox variables of the worker shell. */
  readonly env: Readonly<Record<string, string>>;
  /** Gives the Pi runtime. The default uses the Pi credentials of the host user. Tests give a faux runtime. */
  readonly runtime?: () => Promise<HostPiRuntime>;
  /** The check queue of the host agent. */
  readonly checks?: CheckQueue;
  /** Gives the factory settings of the copy. The check items come from them. */
  readonly settings?: () => FactorySettings;
}

/**
 * Makes the local executor of one remote run. Only this module loads Pi, and the runner imports it only when a run
 * starts. Without a check queue, the worker gets no check tools and no check gate.
 */
export async function openRunExecutor(input: RunExecutorInput): Promise<WorkerExecutor> {
  const { runtime, agentDir } = await (input.runtime ?? createFactoryRuntime)();

  return createLocalExecutor({
    paths: { root: input.copy, runtimeDir: input.runtimeDir },
    ctx: { cwd: input.copy },
    runtime,
    agentDir,
    shim: input.shim,
    gitRoot: input.clone,
    env: input.env,
    ...(input.checks ? { checks: input.checks } : {}),
    ...(input.settings ? { settings: input.settings } : {}),
  });
}
