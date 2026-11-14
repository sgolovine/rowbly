import type { Key } from "ink";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { type FactoryLaunch, startFactory, stopFactory } from "../../../../services/factory/factory.js";
import type { ServiceContext } from "../../../../services/workspace/workspace.js";
import { runExclusive, showToast, type ToastStore } from "../../../hooks/index.js";

/** The process change that a person asked for. */
export type FactoryRunKind = "start" | "stop";

/** What a start or a stop of the factory reads and changes. */
export interface FactoryRunEnv {
  readonly ctx: ServiceContext;
  readonly launch: FactoryLaunch | undefined;
  readonly toast: ToastStore;
  /** True while a start or a stop runs, so a second key press does not start one more. */
  readonly working: RefObject<boolean>;
  readonly checkProvider: () => Promise<boolean>;
  readonly setBusy: Dispatch<SetStateAction<FactoryRunKind | null>>;
  readonly setProvider: Dispatch<SetStateAction<boolean | undefined>>;
}

/** What the keys of the Factory controls read and change. */
export interface FactoryKeyEnv extends FactoryRunEnv {
  readonly canStart: boolean;
  readonly canStop: boolean;
  readonly canInspect: boolean;
  readonly canWarnings: boolean;
  readonly openWarnings: () => void;
  readonly setConfirm: Dispatch<SetStateAction<boolean>>;
  readonly setInspect: Dispatch<SetStateAction<boolean>>;
  readonly setHistory: Dispatch<SetStateAction<boolean>>;
  readonly onAiSettings: (() => void) | undefined;
}

/** Starts or stops the factory, unless a start or a stop runs already. A toast shows the progress. */
export async function runFactory(env: FactoryRunEnv, kind: FactoryRunKind): Promise<void> {
  await runExclusive(env.working, () => runFactoryTask(env, kind));
}

async function runFactoryTask(env: FactoryRunEnv, kind: FactoryRunKind): Promise<void> {
  env.setBusy(kind);

  const progress = env.toast.pending(kind === "start" ? "Starting the factory…" : "Stopping the factory…");

  try {
    await changeFactory(env, kind);
    showToast(env.toast, "info", kind === "start" ? "Started the factory" : "Stopped the factory");
  } catch (error) {
    env.toast.error(error);
  } finally {
    env.toast.dismiss(progress);
    env.setBusy(null);
  }
}

/** A start first checks the providers, so that the Modal can tell the person to sign in. */
async function changeFactory(env: FactoryRunEnv, kind: FactoryRunKind): Promise<void> {
  if (kind === "start" && env.launch) {
    env.setProvider(await env.checkProvider().catch(() => true));
    await startFactory({ launch: env.launch }, env.ctx);

    return;
  }

  await stopFactory({}, env.ctx);
}

/** The keys of the Factory controls: `s` starts, `x` asks to stop, `enter` shows the supervisor. */
export function handleFactoryKey(env: FactoryKeyEnv, input: string, key: Key): void {
  if (key.ctrl || key.meta) {
    return;
  }

  if (input === "s" && env.canStart) {
    void runFactory(env, "start");

    return;
  }

  if (input === "x" && env.canStop) {
    env.setConfirm(true);

    return;
  }

  if (key.return && env.canInspect) {
    env.setInspect(true);

    return;
  }

  openOther(env, input);
}

/** `w` shows the warnings, `h` shows the supervisor history and `a` opens the AI settings. */
function openOther(env: FactoryKeyEnv, input: string): void {
  if (input === "w" && env.canWarnings) {
    env.openWarnings();

    return;
  }

  if (input === "h") {
    env.setHistory(true);

    return;
  }

  if (input === "a" && env.onAiSettings) {
    env.onAiSettings();
  }
}
