import { describe, expect, it } from "vitest";
import type { FactorySettings } from "../factory-settings/factory-settings.js";
import { configuredProviders, connectivityOf, isConnectivityError, networkPauseDelay } from "./connectivity.js";

describe("isConnectivityError", () => {
  it.each([
    "fetch failed",
    "ECONNRESET",
    "ECONNREFUSED",
    "ENOTFOUND",
    "EAI_AGAIN",
    "ETIMEDOUT",
    "ENETUNREACH",
    "EHOSTUNREACH",
    "socket hang up",
    "network error",
    "Connection error.",
    "terminated",
  ])("is true for the message %s", (text) => {
    expect(isConnectivityError(new Error(`request: ${text}`))).toBe(true);
  });

  it("is true for a code and for a nested cause", () => {
    expect(isConnectivityError(Object.assign(new Error("request"), { code: "ECONNRESET" }))).toBe(true);
    const cause = Object.assign(new Error("getaddrinfo"), { code: "ENOTFOUND" });
    expect(isConnectivityError(new Error("outer", { cause: new Error("middle", { cause }) }))).toBe(true);
  });

  it("is false for quota, authentication and other errors", () => {
    expect(isConnectivityError(new Error("429 usage limit"))).toBe(false);
    expect(isConnectivityError(new Error("401 unauthorized"))).toBe(false);
    expect(isConnectivityError(new Error("429 rate limit", { cause: new Error("fetch failed") }))).toBe(false);
    expect(isConnectivityError(new Error("Invalid tool arguments"))).toBe(false);
    expect(isConnectivityError(undefined)).toBe(false);
  });

  it("stops at a cycle of causes", () => {
    const error = new Error("loop") as Error & { cause?: unknown };
    error.cause = error;
    expect(isConnectivityError(error)).toBe(false);
  });
});

describe("networkPauseDelay", () => {
  it("starts at 1 minute, doubles, and stops at 15 minutes", () => {
    expect([1, 2, 3, 4, 5, 6].map((n) => networkPauseDelay(n) / 60_000)).toEqual([1, 2, 4, 8, 15, 15]);
  });
});

describe("connectivityOf", () => {
  const settings: FactorySettings = {
    maxWorkers: 1,
    supervisorModel: { provider: "anthropic", modelId: "a" },
    workerModel: { provider: "anthropic", modelId: "b" },
    stageWorkerModels: { WORK: { provider: "openai", modelId: "c" } },
  } as FactorySettings;

  it("lists each configured provider once", () => {
    expect(configuredProviders(settings)).toEqual(["anthropic", "openai"]);
  });

  it("lists the providers of the tag rules", () => {
    const tagged = { ...settings, tagWorkerModels: { bug: { provider: "google", modelId: "g" } } };
    expect(configuredProviders(tagged)).toEqual(["anthropic", "openai", "google"]);
  });

  it("is online without a network pause", () => {
    expect(connectivityOf(settings, new Map())).toBe("online");
    expect(connectivityOf(settings, new Map([["anthropic", { reason: "quota" }]]))).toBe("online");
    expect(connectivityOf(settings, new Map([["other", { reason: "network" }]]))).toBe("online");
  });

  it("is degraded when one or more providers have a network pause", () => {
    expect(connectivityOf(settings, new Map([["openai", { reason: "network" }]]))).toBe("degraded");
  });

  it("is offline when each configured provider has a network pause", () => {
    const providers = new Map([
      ["anthropic", { reason: "network" }],
      ["openai", { reason: "network" }],
    ]);
    expect(connectivityOf(settings, providers)).toBe("offline");
  });
});
