import type { Key } from "ink";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ValidationError } from "../../../../services/errors/errors.js";
import * as settings from "../../../../services/factory-settings/factory-settings.js";
import { createToastStore } from "../../../hooks/index.js";
import type { AiProvider } from "../ai-view.js";
import {
  type AiEnv,
  finishSignIn,
  finishTask,
  handleAiKey,
  loadStatus,
  pickProvider,
  saveLimit,
} from "./ai-actions.js";

vi.mock("../../../../services/factory-settings/factory-settings.js", async (original) => ({
  ...(await original<typeof import("../../../../services/factory-settings/factory-settings.js")>()),
  updateFactorySettings: vi.fn(async () => ({})),
}));

afterEach(() => {
  vi.clearAllMocks();
});

const state = () => ({ reload: vi.fn(), refresh: vi.fn(), loading: false });

function env(overrides: Partial<AiEnv> = {}): AiEnv {
  return {
    ctx: {},
    toast: createToastStore(),
    runtime: state(),
    status: state(),
    settings: state(),
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
    expect(e.setPage).toHaveBeenNthCalledWith(2, "limits");
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
