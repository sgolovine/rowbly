import { describe, expect, it } from "vitest";
import type { ThreadRecord } from "../../../services/thread/thread.js";
import {
  checksText,
  factoryHints,
  historyModel,
  problemHints,
  providerNotice,
  supervisorText,
  workersText,
} from "./factory-modal-text.js";

describe("factoryModalText", () => {
  it("offers only the actions of a warning that it has", () => {
    expect(problemHints({ story: true, thread: true, dismiss: true }).map((h) => h.key)).toEqual([
      "o",
      "t",
      "d",
      "esc",
    ]);
    expect(problemHints({ story: false, thread: false, dismiss: false }).map((h) => h.key)).toEqual(["esc"]);
  });

  it("offers only the keys that work now", () => {
    expect(
      factoryHints({ start: true, stop: false, inspect: false, warnings: false, aiSettings: false }).map((h) => h.key),
    ).toEqual(["s", "h", "esc"]);
    expect(
      factoryHints({ start: false, stop: true, inspect: true, warnings: true, aiSettings: true }).map((h) => h.key),
    ).toEqual(["x", "enter", "w", "h", "a", "esc"]);
  });

  it("names the supervisor model, the Pi default of a live factory, or nothing", () => {
    expect(supervisorText({ provider: "anthropic", modelId: "m" }, false)).toBe("anthropic/m");
    expect(supervisorText(undefined, true)).toBe("Pi default");
    expect(supervisorText(undefined, false)).toBe("—");
  });

  it("gives the worker counts of a live factory, or the limit", () => {
    const workers = { running: 2, pending: 1, waiting: 0, limit: 4 };

    expect(workersText(true, workers, 4)).toBe("2 running · 1 pending · limit 4");
    expect(workersText(false, workers, 3)).toBe("limit 3");
    expect(workersText(false, undefined, undefined)).toBe("—");
  });

  it("gives the check counts, the limit and the free memory", () => {
    expect(checksText({ running: 2, queued: 1, maxConcurrent: 2, availableMb: 5120, jobs: [] })).toBe(
      "2 running · 1 queued · limit 2 · 5120 MB free",
    );
    expect(checksText({ running: 0, queued: 0, maxConcurrent: 4, jobs: [] })).toBe("0 running · 0 queued · limit 4");
  });

  it("names the model of a history Thread and the way to sign in", () => {
    expect(historyModel({ model: { provider: "openai", modelId: "x" } } as ThreadRecord)).toBe("openai/x");
    expect(historyModel({} as ThreadRecord)).toBe("Pi default");
    expect(providerNotice(true)).toContain("Press a");
    expect(providerNotice(false)).toContain("rowbly auth login");
  });
});
