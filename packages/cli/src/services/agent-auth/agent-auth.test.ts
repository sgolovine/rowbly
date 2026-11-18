import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fauxProvider, InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { configureFactory, getFactorySettings } from "../factory-settings/factory-settings.js";
import { getDeviceId } from "../known-project/known-project.js";
import { piCatalogFile, piCatalogKey, readPiCatalog, writePiCatalog } from "../pi-catalog-cache/pi-catalog-cache.js";
import { loadPi } from "../pi-runtime/pi-runtime.js";
import { createStory } from "../story/story.js";
import { useTempDir, useTestProject } from "../test-project/test-project.js";
import {
  authRuntime,
  getAuthStatus,
  listAvailableModels,
  loginProvider,
  logoutProvider,
  resetAuthRuntime,
} from "./agent-auth.js";

const createFactoryRuntime = vi.hoisted(() => vi.fn());

vi.mock("../pi-runtime/factory-runtime.js", () => ({ createFactoryRuntime }));

describe("shared auth runtime", () => {
  afterEach(() => {
    resetAuthRuntime();
    createFactoryRuntime.mockReset();
  });
  function runtimeResult(name: string) {
    return { runtime: { name }, agentDir: "/agent" };
  }
  it("creates one runtime for all callers, also for concurrent callers", async () => {
    createFactoryRuntime.mockImplementation(async () => runtimeResult("first"));
    const [a, b] = await Promise.all([authRuntime(), authRuntime()]);
    const c = await authRuntime();
    expect(createFactoryRuntime).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
    expect(c).toBe(a);
    expect(a).toEqual({ name: "first" });
  });
  it("creates a new runtime after a reset", async () => {
    createFactoryRuntime.mockImplementationOnce(async () => runtimeResult("first"));
    createFactoryRuntime.mockImplementationOnce(async () => runtimeResult("second"));
    const first = await authRuntime();
    resetAuthRuntime();
    const second = await authRuntime();
    expect(createFactoryRuntime).toHaveBeenCalledTimes(2);
    expect(second).not.toBe(first);
    expect(second).toEqual({ name: "second" });
    expect(await authRuntime()).toBe(second);
  });
  it("forgets a runtime that failed, so that the next call tries again", async () => {
    const error = new Error("no runtime");
    createFactoryRuntime.mockRejectedValueOnce(error);
    createFactoryRuntime.mockImplementationOnce(async () => runtimeResult("retry"));
    await expect(authRuntime()).rejects.toBe(error);
    expect(await authRuntime()).toEqual({ name: "retry" });
    expect(createFactoryRuntime).toHaveBeenCalledTimes(2);
  });
  it("keeps a newer runtime when an older creation fails after a reset", async () => {
    const error = new Error("late failure");
    const late = { reject: (_: Error) => {} };
    createFactoryRuntime.mockReturnValueOnce(
      new Promise((_, reject) => {
        late.reject = reject;
      }),
    );
    createFactoryRuntime.mockImplementationOnce(async () => runtimeResult("newer"));
    const failing = authRuntime();
    resetAuthRuntime();
    const newer = await authRuntime();
    late.reject(error);
    await expect(failing).rejects.toBe(error);
    expect(await authRuntime()).toBe(newer);
    expect(createFactoryRuntime).toHaveBeenCalledTimes(2);
  });
});

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
    await expect(logoutProvider(runtime, "openai", { home: dir.path })).rejects.toMatchObject({
      message: "Provider logout did not complete",
    });
    expect(settle).toHaveBeenCalledTimes(3);
  });
  it("deletes the model cache after each login and logout, also after a failure", async () => {
    const { runtime } = await fixture();
    const ctx = { home: dir.path };
    const writeCache = async () =>
      writePiCatalog({ models: [], providers: [] }, await piCatalogKey(ctx, { env: {} }), ctx);
    const cached = async () => (await readPiCatalog(ctx, { env: {} })) !== undefined;
    const interaction = { prompt: vi.fn(), notify: vi.fn() };
    const login = vi.spyOn(runtime, "login").mockResolvedValue({ type: "api_key", key: "SECRET" });
    const logout = vi.spyOn(runtime, "logout").mockResolvedValue(undefined);

    await writeCache();
    expect(await cached()).toBe(true);
    await loginProvider(runtime, "openai", "api_key", interaction, ctx);
    expect(await cached()).toBe(false);

    await writeCache();
    login.mockRejectedValue(new Error("no"));
    await expect(loginProvider(runtime, "openai", "api_key", interaction, ctx)).rejects.toThrow();
    expect(await cached()).toBe(false);

    await writeCache();
    await logoutProvider(runtime, "openai", ctx);
    expect(await cached()).toBe(false);

    await writeCache();
    logout.mockRejectedValue(new Error("no"));
    await expect(logoutProvider(runtime, "openai", ctx)).rejects.toThrow();
    expect(await cached()).toBe(false);
    expect(piCatalogFile(ctx).startsWith(dir.path)).toBe(true);
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
      placement: "prefer-local",
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
      placement: "prefer-local",
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
      placement: "prefer-local",
    });
  });
});
