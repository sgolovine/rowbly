import type { Key } from "ink";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ValidationError } from "../../../../services/errors/errors.js";
import * as settings from "../../../../services/factory-settings/factory-settings.js";
import type { Stage } from "../../../../services/stage/stage.js";
import { createToastStore } from "../../../hooks/index.js";
import type { AiProvider } from "../ai-view.js";
import {
  type AiEnv,
  finishSignIn,
  finishTask,
  handleAiKey,
  loadStatus,
  openStageModel,
  pickProvider,
  saveLimit,
  saveStageModel,
} from "./ai-actions.js";

vi.mock("../../../../services/factory-settings/factory-settings.js", async (original) => ({
  ...(await original<typeof import("../../../../services/factory-settings/factory-settings.js")>()),
  updateFactorySettings: vi.fn(async () => ({})),
  setWorkerOverride: vi.fn(async () => ({})),
}));

afterEach(() => {
  vi.clearAllMocks();
});

const state = () => ({ reload: vi.fn(), refresh: vi.fn(), loading: false });
const backlog = { key: "BACKLOG", label: "Backlog" } as Stage;
const done = { key: "DONE", label: "Done" } as Stage;

function env(overrides: Partial<AiEnv> = {}): AiEnv {
  return {
    ctx: {},
    toast: createToastStore(),
    runtime: state(),
    status: state(),
    settings: state(),
    stages: { ...state(), data: [backlog, done] },
    stageCursor: 0,
    setStageCursor: vi.fn(),
    providers: [
      { id: "acme", methods: ["api_key"], configured: true },
      { id: "none", methods: [], configured: false },
    ] as unknown as AiProvider[],
    page: "providers",
    ready: true,
    canSignOut: true,
    setPage: vi.fn(),
    setTask: vi.fn(),
    setSelected: vi.fn(),
    onChange: vi.fn(),
    ...overrides,
  } as AiEnv;
}

const key = (overrides: Partial<Key> = {}) => ({ ...overrides }) as Key;

describe("aiActions", () => {
  it("reads nothing without a runtime", async () => {
    await expect(loadStatus(undefined)).resolves.toBeUndefined();
  });

  it("opens the task of each key, and reloads with r", () => {
    const e = env();

    handleAiKey(e, "d", key());
    handleAiKey(e, "s", key());
    handleAiKey(e, "w", key());
    handleAiKey(e, "l", key());
    handleAiKey(e, "r", key());
    handleAiKey(e, "l", key({ ctrl: true }));

    expect(e.setTask).toHaveBeenNthCalledWith(1, { kind: "signOut" });
    expect(e.setTask).toHaveBeenNthCalledWith(2, { kind: "model", role: "supervisor" });
    expect(e.setTask).toHaveBeenNthCalledWith(3, { kind: "model", role: "worker" });
    expect(e.setTask).toHaveBeenNthCalledWith(4, { kind: "limit" });
    expect(e.setTask).toHaveBeenCalledTimes(4);
    expect(e.runtime.reload).toHaveBeenCalledOnce();
    expect(e.settings.reload).toHaveBeenCalledOnce();
    expect(e.stages.reload).toHaveBeenCalledOnce();
  });

  it("selects a Stage with the arrows on the Models tab, and opens its picker with enter only when Pi has loaded", () => {
    const e = env({ page: "models", stageCursor: 1 });

    handleAiKey(e, "", key({ downArrow: true }));
    handleAiKey(e, "k", key());
    handleAiKey(e, "", key({ return: true }));

    const update = vi.mocked(e.setStageCursor).mock.calls[0]?.[0] as (n: number) => number;

    expect(update(1)).toBe(1);
    expect(update(0)).toBe(1);
    expect(e.setTask).toHaveBeenCalledWith({ kind: "stageModel", stage: done });

    const notReady = env({ page: "models", ready: false });

    handleAiKey(notReady, "", key({ return: true }));
    openStageModel(notReady, 1);

    expect(notReady.setTask).not.toHaveBeenCalled();
    expect(notReady.setStageCursor).toHaveBeenCalledWith(1);
  });

  it("saves and removes a Stage override through the service, then closes the picker", async () => {
    const e = env();

    await saveStageModel(e, backlog, { provider: "acme", modelId: "deep-1", thinkingLevel: "high" });
    await saveStageModel(e, backlog, null);

    expect(settings.setWorkerOverride).toHaveBeenNthCalledWith(
      1,
      { stage: "BACKLOG" },
      { provider: "acme", modelId: "deep-1", thinkingLevel: "high" },
      {},
    );
    expect(settings.setWorkerOverride).toHaveBeenNthCalledWith(2, { stage: "BACKLOG" }, undefined, {});
    expect(e.toast.list().map((t) => t.message)).toEqual([
      "Saved the Backlog worker model: acme/deep-1 · thinking high",
      "Removed the Backlog worker model",
    ]);
    expect(e.setTask).toHaveBeenCalledWith(null);
    expect(e.onChange).toHaveBeenCalledTimes(2);
  });

  it("does not change models, sign out or open the sign-in page before the providers load", () => {
    const e = env({ ready: false, canSignOut: false });

    handleAiKey(e, "d", key());
    handleAiKey(e, "s", key());
    handleAiKey(e, "n", key());

    expect(e.setTask).not.toHaveBeenCalled();
    expect(e.setPage).not.toHaveBeenCalled();
  });

  it("changes the tab with the arrows, with a wrap at the ends", () => {
    const e = env();

    handleAiKey(e, "", key({ rightArrow: true }));
    handleAiKey(e, "", key({ leftArrow: true }));

    expect(e.setPage).toHaveBeenNthCalledWith(1, "models");
    expect(e.setPage).toHaveBeenNthCalledWith(2, "checks");
    expect(e.setSelected).toHaveBeenCalledWith(undefined);
  });

  it("opens the sign-in page with n, and keeps the arrows and d for the list of that page", () => {
    const providers = env();

    handleAiKey(providers, "n", key());

    expect(providers.setPage).toHaveBeenCalledWith("addProvider");

    const addProvider = env({ page: "addProvider" });

    handleAiKey(addProvider, "", key({ rightArrow: true }));
    handleAiKey(addProvider, "d", key());
    handleAiKey(addProvider, "n", key());

    expect(addProvider.setPage).not.toHaveBeenCalled();
    expect(addProvider.setTask).not.toHaveBeenCalled();
  });

  it("goes back to the signed-in providers only after a completed sign-in", () => {
    const cancelled = env({ page: "addProvider" });

    finishSignIn(cancelled, false);

    expect(cancelled.setPage).not.toHaveBeenCalled();

    const signedIn = env({ page: "addProvider" });

    finishSignIn(signedIn, true);

    expect(signedIn.setPage).toHaveBeenCalledWith("providers");
    expect(signedIn.onChange).toHaveBeenCalledOnce();
  });

  it("starts the sign-in only for a provider with a method", () => {
    const e = env();

    pickProvider(e, "none");
    pickProvider(e, "acme");

    expect(e.setSelected).toHaveBeenCalledTimes(2);
    expect(e.setTask).toHaveBeenCalledOnce();
    expect(e.setTask).toHaveBeenCalledWith({ kind: "signIn" });
  });

  it("reads again only after a change", () => {
    const e = env();

    finishTask(e, false);

    expect(e.onChange).not.toHaveBeenCalled();

    finishTask(e, true);

    expect(e.status.reload).toHaveBeenCalledOnce();
    expect(e.onChange).toHaveBeenCalledOnce();
  });

  it("refuses a worker limit that is not a whole number from one", async () => {
    const e = env();

    await expect(saveLimit(e, { maxWorkers: 0 })).rejects.toBeInstanceOf(ValidationError);
    await saveLimit(e, { maxWorkers: 3 });

    expect(settings.updateFactorySettings).toHaveBeenCalledWith({ maxWorkers: 3 }, {});
    expect(e.toast.list().map((t) => t.message)).toEqual(["Saved the worker limit: 3"]);
  });
});
