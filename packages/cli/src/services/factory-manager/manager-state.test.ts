import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type ProviderPause,
  type ProviderState,
  pausedProviders,
  pauseProvider,
  providerSucceeded,
} from "./manager-state.js";

const NOW = Date.parse("2026-01-01T00:00:00.000Z");
const minutesFromNow = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString();

type PauseState = ProviderState;

const empty = (): PauseState => ({ providers: new Map(), networkFailures: new Map() });

describe("pausedProviders", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("never pauses the placeholder provider of Pi", () => {
    const providers = new Map<string, ProviderPause>();
    expect(pausedProviders(providers, "unknown", new Error("401 unauthorized"))).toBe(providers);
  });

  it("keeps the quota and authentication rules", () => {
    vi.useFakeTimers({ toFake: ["Date"], now: NOW });
    expect(pausedProviders(new Map(), "p", new Error("429 usage limit")).get("p")).toEqual({
      reason: "quota",
      retryAt: minutesFromNow(15),
    });
    expect(pausedProviders(new Map(), "p", new Error("401 unauthorized")).get("p")).toEqual({
      reason: "authentication",
    });
    const providers = new Map<string, ProviderPause>();
    expect(pausedProviders(providers, "p", new Error("Invalid tool call"))).toBe(providers);
    expect(pausedProviders(providers, undefined, new Error("fetch failed"))).toBe(providers);
  });

  it("gives a network pause of 1 minute for the first connectivity error", () => {
    vi.useFakeTimers({ toFake: ["Date"], now: NOW });
    expect(pausedProviders(new Map(), "p", new Error("fetch failed")).get("p")).toEqual({
      reason: "network",
      retryAt: minutesFromNow(1),
      failures: 1,
    });
  });

  it("doubles the delay of each later network pause in a row, to a maximum of 15 minutes", () => {
    vi.useFakeTimers({ toFake: ["Date"], now: NOW });
    const delays: number[] = [];
    let state = empty();
    for (let index = 0; index < 6; index += 1) {
      state = { ...state, ...pauseProvider(state, "p", new Error("fetch failed")) };
      const pause = state.providers.get("p");
      delays.push((Date.parse(pause?.retryAt ?? "") - Date.now()) / 60_000);
      // The pause ends before the next failure.
      vi.setSystemTime(Date.parse(pause?.retryAt ?? ""));
    }
    expect(delays).toEqual([1, 2, 4, 8, 15, 15]);
    expect(state.networkFailures.get("p")).toBe(6);
  });

  it("does not make a pause that still holds longer", () => {
    vi.useFakeTimers({ toFake: ["Date"], now: NOW });
    const first = pauseProvider(empty(), "p", new Error("fetch failed"));
    const second = pauseProvider(first, "p", new Error("ECONNRESET"));
    expect(second.providers).toBe(first.providers);
    expect(second.networkFailures.get("p")).toBe(1);
  });

  it("starts at 1 minute again after a successful prompt", () => {
    vi.useFakeTimers({ toFake: ["Date"], now: NOW });
    const first = pauseProvider(empty(), "p", new Error("fetch failed"));
    vi.setSystemTime(NOW + 2 * 60_000);
    const reset = { providers: new Map(), ...providerSucceeded(first, "p") };
    expect(reset.networkFailures.has("p")).toBe(false);
    const next = pauseProvider(reset, "p", new Error("fetch failed"));
    expect(next.providers.get("p")).toEqual({ reason: "network", retryAt: minutesFromNow(1), failures: 1 });
  });
});
