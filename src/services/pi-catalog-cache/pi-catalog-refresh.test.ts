import { describe, expect, it, vi } from "vitest";
import type { AuthRuntime } from "../agent-auth/agent-auth.js";
import { useTempDir } from "../test-project/test-project.js";
import { piCatalogKey, readPiCatalog, writePiCatalog } from "./pi-catalog-cache.js";
import {
  loadPiCatalog,
  type PiCatalogSource,
  piProviderReady,
  refreshPiCatalog,
  runtimeSource,
} from "./pi-catalog-refresh.js";

vi.mock("@earendil-works/pi-coding-agent", () => {
  throw new Error("The catalog refresh test must not load Pi");
});

function fakeRuntime(configured: boolean): AuthRuntime {
  return {
    getProviders: () => [{ id: "acme", auth: { apiKey: { login: true } } }],
    listCredentials: async () => [],
    getAvailable: async () =>
      configured ? [{ provider: "acme", id: "fast-1", name: "Fast One", reasoning: false }] : [],
  } as unknown as AuthRuntime;
}

/** A faux source, as the Pi worker gives: plain data, no runtime. */
function fakeSource(configured: boolean): PiCatalogSource {
  return {
    listAvailableModels: vi.fn(async () =>
      configured ? [{ provider: "acme", modelId: "fast-1", name: "Fast One", thinkingLevels: ["off" as const] }] : [],
    ),
    getAuthStatus: vi.fn(async () => [
      {
        id: "acme",
        methods: ["api_key" as const],
        configured,
        credentialType: undefined,
        health: "unverified" as const,
      },
    ]),
  };
}

function untouched(source: PiCatalogSource): void {
  expect(source.listAvailableModels).not.toHaveBeenCalled();
  expect(source.getAuthStatus).not.toHaveBeenCalled();
}

describe("pi catalog refresh", () => {
  const home = useTempDir();
  const options = { env: {} };
  const ctx = () => ({ home: home.path });

  it("loads the models and the providers through the source and writes the cache", async () => {
    const catalog = await refreshPiCatalog(fakeSource(true), ctx(), options);
    expect(catalog.models).toEqual([
      { provider: "acme", modelId: "fast-1", name: "Fast One", thinkingLevels: ["off"] },
    ]);
    expect(catalog.providers).toMatchObject([{ id: "acme", methods: ["api_key"], configured: true }]);
    expect(await readPiCatalog(ctx(), options)).toEqual({ ...catalog, fresh: true });
  });

  it("gives the same data through `runtimeSource` as through the runtime", async () => {
    const fromRuntime = await refreshPiCatalog(runtimeSource(fakeRuntime(true)), ctx(), options);
    const fromSource = await refreshPiCatalog(fakeSource(true), ctx(), options);
    expect(fromRuntime).toEqual(fromSource);
  });

  it("answers from a fresh cache without a read of the source", async () => {
    await refreshPiCatalog(fakeSource(true), ctx(), options);
    const source = fakeSource(false);
    expect((await loadPiCatalog(source, ctx(), options)).providers[0]?.configured).toBe(true);
    expect(await piProviderReady(source, ctx())).toBe(true);
    untouched(source);
  });

  it("reads the source and refreshes a stale or missing cache", async () => {
    const source = fakeSource(false);
    expect(await piProviderReady(source, ctx())).toBe(false);
    expect(source.getAuthStatus).toHaveBeenCalledOnce();
    expect((await readPiCatalog(ctx(), options))?.providers[0]?.configured).toBe(false);

    const old = await piCatalogKey(ctx(), { ...options, version: "0.0.1-old" });
    await writePiCatalog({ models: [], providers: [] }, old, ctx());
    expect(await piProviderReady(fakeSource(true), ctx())).toBe(true);
    expect((await readPiCatalog(ctx(), options))?.fresh).toBe(true);
  });
});
