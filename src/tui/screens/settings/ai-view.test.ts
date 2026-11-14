import { describe, expect, it } from "vitest";
import type { Stage } from "../../../services/stage/stage.js";
import {
  type AiProvider,
  aiHints,
  modelText,
  nextTab,
  pageProviders,
  providerStatus,
  stageModelItems,
  tabIndex,
} from "./ai-view.js";

describe("aiView", () => {
  it("names the sign-in state of a provider", () => {
    expect(providerStatus({ configured: true, credentialType: "oauth" })).toBe("signed in with an account");
    expect(providerStatus({ configured: true, credentialType: "api_key" })).toBe("signed in with an API key");
    expect(providerStatus({ configured: true })).toBe("configured outside Rowbly");
    expect(providerStatus({ configured: false })).toBe("not signed in");
  });

  it("names a model choice with its thinking level, or the Pi default", () => {
    expect(modelText(undefined)).toBe("Pi default");
    expect(modelText({ provider: "a", modelId: "m" })).toBe("a/m");
    expect(modelText({ provider: "a", modelId: "m", thinkingLevel: "high" })).toBe("a/m · thinking high");
  });

  it("gives each Stage its override, or the worker model without one", () => {
    const stages = [
      { key: "BACKLOG", label: "Backlog" },
      { key: "DONE", label: "Done" },
    ] as Stage[];
    const settings = {
      version: 1 as const,
      maxWorkers: 4,
      stageWorkerModels: { DONE: { provider: "a", modelId: "m", thinkingLevel: "low" as const } },
    };

    expect(stageModelItems(settings, stages)).toEqual([
      { stage: stages[0], value: "Worker model", inherited: true },
      { stage: stages[1], value: "a/m · thinking low", inherited: false },
    ]);
  });

  it("offers only the keys of the page that work now", () => {
    const none = { idle: true, list: false, signIn: false, signOut: false, ready: false };
    const all = { idle: true, list: true, signIn: true, signOut: true, ready: true };
    const keysOf = (hints: { key: string }[]) => hints.map((hint) => hint.key);

    expect(aiHints("providers", { ...all, idle: false })).toEqual([]);
    expect(keysOf(aiHints("providers", none))).toEqual(["r", "←/→"]);
    expect(keysOf(aiHints("providers", all))).toEqual(["↑/↓", "/", "d", "n", "r", "←/→"]);
    expect(keysOf(aiHints("addProvider", all))).toEqual(["↑/↓", "/", "enter", "esc"]);
    expect(keysOf(aiHints("addProvider", none))).toEqual(["esc"]);
    expect(keysOf(aiHints("models", all))).toEqual(["s", "w", "←/→"]);
    expect(keysOf(aiHints("models", none))).toEqual(["←/→"]);
    expect(keysOf(aiHints("models", { ...all, stages: true }))).toEqual(["s", "w", "↑/↓", "enter", "←/→"]);
    expect(keysOf(aiHints("models", { ...none, stages: true }))).toEqual(["←/→"]);
    expect(keysOf(aiHints("limits", none))).toEqual(["l", "←/→"]);
  });

  it("puts the sign-in page under the Providers tab, and wraps the tabs at the ends", () => {
    expect(tabIndex("addProvider")).toBe(0);
    expect(tabIndex("limits")).toBe(2);
    expect(nextTab("providers", 1)).toBe("models");
    expect(nextTab("addProvider", 1)).toBe("models");
    expect(nextTab("limits", 1)).toBe("providers");
    expect(nextTab("providers", -1)).toBe("limits");
  });

  it("splits the providers into the signed-in providers and the other providers", () => {
    const providers = [
      { id: "stored", configured: false, credentialType: "oauth" },
      { id: "env", configured: true },
      { id: "none", configured: false },
    ] as unknown as AiProvider[];
    const ids = (list: readonly AiProvider[]) => list.map((provider) => provider.id);

    expect(ids(pageProviders("providers", providers))).toEqual(["stored", "env"]);
    expect(ids(pageProviders("addProvider", providers))).toEqual(["none"]);
    expect(pageProviders("models", providers)).toEqual([]);
  });
});
