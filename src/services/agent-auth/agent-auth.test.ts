import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fauxProvider, InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { configureFactory, getFactorySettings } from "../factory-settings/factory-settings.js";
import { getDeviceId } from "../known-project/known-project.js";
import { loadPi } from "../pi-runtime/pi-runtime.js";
import { createStory } from "../story/story.js";
import { useTempDir, useTestProject } from "../test-project/test-project.js";
import { getAuthStatus, listAvailableModels, loginProvider, logoutProvider } from "./agent-auth.js";

describe("agent auth", () => {
  const dir = useTempDir();
  const project = useTestProject();
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
  async function fixture() {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        throw new Error("Unexpected fetch");
      }),
    );
    const sdk = await loadPi();
    const runtime = await sdk.ModelRuntime.create({
      credentials: new InMemoryCredentialStore(),
      modelsPath: null,
      refreshOnCreate: false,
      allowModelNetwork: false,
    });
    const faux = fauxProvider();
    runtime.registerNativeProvider(faux.provider);
    return { runtime, faux };
  }
  it("keeps a stable device ID and preserves unrelated rc keys", async () => {
    const file = join(dir.path, ".rowblyrc.json");
    await writeFile(file, JSON.stringify({ other: { enabled: true }, projects: [] }));
    const id = await getDeviceId({ home: dir.path });
    expect(await getDeviceId({ home: dir.path })).toBe(id);
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual({ other: { enabled: true }, projects: [], deviceId: id });
    await writeFile(file, "invalid");
    await expect(getDeviceId({ home: dir.path })).rejects.toThrow("invalid");
    expect(await readFile(file, "utf8")).toBe("invalid");
  });
  it("does not equate configured availability with healthy authentication", async () => {
    const { runtime, faux } = await fixture();
    expect((await getAuthStatus(runtime)).find((p) => p.id === faux.provider.id)).toMatchObject({
      configured: true,
      health: "unverified",
    });
    expect(await listAvailableModels(runtime, faux.provider.id)).toContainEqual(
      expect.objectContaining({ modelId: faux.getModel().id }),
    );
    expect(fetch).not.toHaveBeenCalled();
  });
  it("discards credentials and sanitizes credential-bearing errors", async () => {
    const { runtime } = await fixture();
    const login = vi.spyOn(runtime, "login").mockResolvedValue({ type: "api_key", key: "SECRET" });
    const settle = vi.spyOn(runtime, "settleCredentialWrites");
    const interaction = { prompt: vi.fn(), notify: vi.fn() };
    const result = await loginProvider(runtime, "openai", "api_key", interaction, { home: dir.path });
    expect(result).toEqual({ provider: "openai", type: "api_key" });
    expect(login.mock.calls[0]?.[3]).toMatchObject({ agentName: "rowbly" });
    login.mockRejectedValue({ message: "SECRET", credential: { key: "SECRET" } });
    await expect(loginProvider(runtime, "openai", "api_key", interaction, { home: dir.path })).rejects.toMatchObject({
      message: "Provider login did not complete",
    });
    vi.spyOn(runtime, "logout").mockRejectedValue({ credential: "SECRET" });
    await expect(logoutProvider(runtime, "openai")).rejects.toMatchObject({
      message: "Provider logout did not complete",
    });
    expect(settle).toHaveBeenCalledTimes(3);
  });
  it("rejects unavailable explicit models and unsupported thinking without settings changes", async () => {
    const { runtime, faux } = await fixture();
    const choice = `${faux.provider.id}/${faux.getModel().id}`;
    await expect(configureFactory({ worker: "absent/model" }, project.ctx, runtime)).rejects.toThrow("unavailable");
    await expect(configureFactory({ worker: choice, workerThinking: "max" }, project.ctx, runtime)).rejects.toThrow(
      "thinking",
    );
    expect(await getFactorySettings(project.ctx)).toEqual({
      maxWorkers: 4,
      git: { push: false, pull: false, syncIntervalSeconds: 300 },
    });
    expect(await configureFactory({ worker: choice, workerThinking: "off" }, project.ctx, runtime)).toMatchObject({
      workerModel: { thinkingLevel: "off" },
    });
  });
  it("validates override models before it writes Stage and Story overrides", async () => {
    const { runtime, faux } = await fixture();
    const choice = `${faux.provider.id}/${faux.getModel().id}`;
    const model = { provider: faux.provider.id, modelId: faux.getModel().id };
    const story = await createStory({ title: "Override" }, project.ctx);
    await expect(configureFactory({ stage: "BACKLOG", worker: "absent/model" }, project.ctx, runtime)).rejects.toThrow(
      "unavailable",
    );
    await expect(
      configureFactory({ stage: "BACKLOG", worker: choice, workerThinking: "max" }, project.ctx, runtime),
    ).rejects.toThrow("thinking");
    expect(await getFactorySettings(project.ctx)).toEqual({
      maxWorkers: 4,
      git: { push: false, pull: false, syncIntervalSeconds: 300 },
    });
    await configureFactory({ worker: choice }, project.ctx, runtime);
    await configureFactory({ stage: "backlog", worker: choice, workerThinking: "off" }, project.ctx, runtime);
    await configureFactory({ stage: "DONE", story: story.id, worker: choice }, project.ctx, runtime);
    expect(await getFactorySettings(project.ctx)).toEqual({
      maxWorkers: 4,
      workerModel: model,
      stageWorkerModels: { BACKLOG: { ...model, thinkingLevel: "off" } },
      storyWorkerModels: { [story.id]: { DONE: model } },
      git: { push: false, pull: false, syncIntervalSeconds: 300 },
    });
  });
});
