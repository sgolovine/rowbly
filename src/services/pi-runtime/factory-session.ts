import { mkdir } from "node:fs/promises";
import { join, relative } from "node:path";
import type { CreateAgentSessionOptions, ModelRuntime } from "@earendil-works/pi-coding-agent";
import { ValidationError } from "../errors/errors.js";
import type { ModelChoice } from "../factory-settings/factory-settings.js";
import type { ThreadRecord } from "../thread/thread.js";
import { createPiSession, loadPi, type PiSession } from "./pi-runtime.js";

export interface FactorySessionOptions {
  thread: ThreadRecord;
  runtimeDir: string;
  agentDir: string;
  runtime: ModelRuntime;
  choice?: ModelChoice;
  tools: NonNullable<CreateAgentSessionOptions["customTools"]>;
  worker?: { cwd: string; root: string; shim: string };
}
/** Resolves a real model through Pi. Injected runtimes use the same session path in tests. */
export async function openFactorySession(
  o: FactorySessionOptions,
): Promise<{ handle: PiSession; model: ModelChoice; file: string }> {
  const sdk = await loadPi();
  if (o.choice) {
    const { validateModelChoice } = await import("../agent-auth/agent-auth.js");
    await validateModelChoice(o.runtime, o.choice);
  }
  const dir = `${o.runtimeDir}/sessions/${o.thread.id}`;
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const manager =
    o.thread.runs.length > 1 && o.thread.session.file
      ? sdk.SessionManager.open(join(o.runtimeDir, o.thread.session.file), dir, o.worker?.cwd ?? o.thread.cwd)
      : sdk.SessionManager.create(o.worker?.cwd ?? o.thread.cwd, dir, { id: o.thread.id });
  const model = o.choice ? o.runtime.getModel(o.choice.provider, o.choice.modelId) : undefined;
  if (o.choice && !model) {
    throw new ValidationError(`Model unavailable: ${o.choice.provider}/${o.choice.modelId}`);
  }
  const tools = [...o.tools];
  if (o.worker) {
    const w = o.worker;
    const bash = sdk.createBashToolDefinition(w.cwd, {
      spawnHook: (context) => ({
        ...context,
        env: {
          ...context.env,
          PATH: `${w.shim.slice(0, w.shim.lastIndexOf("/"))}:${context.env.PATH ?? ""}`,
          ROWBLY_ROOT: w.root,
          ROWBLY_CLI: w.shim,
        },
      }),
    });
    tools.push(bash as unknown as (typeof tools)[number]);
  }
  const settingsManager = sdk.SettingsManager.inMemory({
    compaction: { enabled: false },
    retry: { enabled: false },
    cacheWarming: "off",
  });
  const resourceLoader = new sdk.DefaultResourceLoader({
    cwd: o.worker?.cwd ?? o.thread.cwd,
    agentDir: o.agentDir,
    settingsManager,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: !o.worker,
  });
  await resourceLoader.reload();
  const handle = await createPiSession({
    cwd: o.worker?.cwd ?? o.thread.cwd,
    agentDir: o.agentDir,
    modelRuntime: o.runtime,
    model,
    thinkingLevel: o.choice?.thinkingLevel,
    sessionManager: manager,
    settingsManager,
    resourceLoader,
    tools: o.worker
      ? ["read", "edit", "write", "grep", "find", "ls", "bash", "report_result"]
      : tools.map((t) => t.name),
    customTools: tools,
  });
  if (!handle.session.model) {
    await handle.close();
    throw new ValidationError("No authenticated model is available. Configure Pi credentials first.");
  }
  const selected = handle.session.model;
  return {
    handle,
    model: { provider: selected.provider, modelId: selected.id, thinkingLevel: o.choice?.thinkingLevel },
    file: relative(o.runtimeDir, manager.getSessionFile() ?? ""),
  };
}
