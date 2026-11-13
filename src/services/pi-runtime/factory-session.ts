import { mkdir } from "node:fs/promises";
import { join, relative } from "node:path";
import type { CreateAgentSessionOptions, ModelRuntime, SessionManager } from "@earendil-works/pi-coding-agent";
import { ValidationError } from "../errors/errors.js";
import type { ModelChoice } from "../factory-settings/factory-settings.js";
import type { ThreadRecord } from "../thread/thread.js";
import { createPiSession, loadPi, type PiSdk, type PiSession } from "./pi-runtime.js";

export interface FactorySessionOptions {
  thread: ThreadRecord;
  runtimeDir: string;
  agentDir: string;
  runtime: ModelRuntime;
  choice?: ModelChoice;
  tools: NonNullable<CreateAgentSessionOptions["customTools"]>;
  worker?: { cwd: string; root: string; shim: string };
}
type FactoryTools = FactorySessionOptions["tools"];

interface OpenedSession {
  readonly handle: PiSession;
  readonly model: ModelChoice;
  readonly file: string;
}

const WORKER_TOOLS = ["read", "edit", "write", "grep", "find", "ls", "bash", "report_result"];

function sessionCwd(o: FactorySessionOptions): string {
  return o.worker?.cwd ?? o.thread.cwd;
}

/** Opens the history of a resumed Thread, or creates the first history of a new Thread. */
function sessionManager(sdk: PiSdk, o: FactorySessionOptions, dir: string): SessionManager {
  if (o.thread.runs.length > 1 && o.thread.session.file) {
    return sdk.SessionManager.open(join(o.runtimeDir, o.thread.session.file), dir, sessionCwd(o));
  }

  return sdk.SessionManager.create(sessionCwd(o), dir, { id: o.thread.id });
}

function selectedModel(o: FactorySessionOptions): ReturnType<ModelRuntime["getModel"]> {
  const model = o.choice ? o.runtime.getModel(o.choice.provider, o.choice.modelId) : undefined;

  if (o.choice && !model) {
    throw new ValidationError(`Model unavailable: ${o.choice.provider}/${o.choice.modelId}`);
  }

  return model;
}

/** Gives the worker bash tool. Its shell finds the exact Rowbly CLI shim first on the PATH. */
function workerBash(sdk: PiSdk, worker: NonNullable<FactorySessionOptions["worker"]>): FactoryTools[number] {
  const bash = sdk.createBashToolDefinition(worker.cwd, {
    spawnHook: (context) => ({
      ...context,
      env: {
        ...context.env,
        PATH: `${worker.shim.slice(0, worker.shim.lastIndexOf("/"))}:${context.env.PATH ?? ""}`,
        ROWBLY_ROOT: worker.root,
        ROWBLY_CLI: worker.shim,
      },
    }),
  });

  return bash as unknown as FactoryTools[number];
}

async function loadResources(
  sdk: PiSdk,
  o: FactorySessionOptions,
): Promise<Pick<CreateAgentSessionOptions, "settingsManager" | "resourceLoader">> {
  const settingsManager = sdk.SettingsManager.inMemory({
    compaction: { enabled: false },
    retry: { enabled: false },
    cacheWarming: "off",
  });
  const resourceLoader = new sdk.DefaultResourceLoader({
    cwd: sessionCwd(o),
    agentDir: o.agentDir,
    settingsManager,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: !o.worker,
  });

  await resourceLoader.reload();

  return { settingsManager, resourceLoader };
}

async function validateChoice(o: FactorySessionOptions): Promise<void> {
  if (!o.choice) {
    return;
  }

  const { validateModelChoice } = await import("../agent-auth/agent-auth.js");

  await validateModelChoice(o.runtime, o.choice);
}

/** Resolves a real model through Pi. Injected runtimes use the same session path in tests. */
export async function openFactorySession(o: FactorySessionOptions): Promise<OpenedSession> {
  const sdk = await loadPi();

  await validateChoice(o);

  const dir = `${o.runtimeDir}/sessions/${o.thread.id}`;

  await mkdir(dir, { recursive: true, mode: 0o700 });

  const manager = sessionManager(sdk, o, dir);
  const model = selectedModel(o);
  const tools = o.worker ? [...o.tools, workerBash(sdk, o.worker)] : [...o.tools];
  const resources = await loadResources(sdk, o);

  const handle = await createPiSession({
    cwd: sessionCwd(o),
    agentDir: o.agentDir,
    modelRuntime: o.runtime,
    model,
    thinkingLevel: o.choice?.thinkingLevel,
    sessionManager: manager,
    ...resources,
    tools: o.worker ? WORKER_TOOLS : tools.map((t) => t.name),
    customTools: tools,
  });
  const selected = handle.session.model;

  if (!selected) {
    await handle.close();
    throw new ValidationError("No authenticated model is available. Configure Pi credentials first.");
  }

  return {
    handle,
    model: { provider: selected.provider, modelId: selected.id, thinkingLevel: o.choice?.thinkingLevel },
    file: relative(o.runtimeDir, manager.getSessionFile() ?? ""),
  };
}
