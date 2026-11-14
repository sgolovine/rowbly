import { describe, expect, it, vi } from "vitest";
import type { AuthRuntime } from "../agent-auth/agent-auth.js";
import { useTempDir } from "../test-project/test-project.js";
import { piCatalogKey, readPiCatalog, writePiCatalog } from "./pi-catalog-cache.js";
import { loadPiCatalog, piProviderReady, refreshPiCatalog } from "./pi-catalog-refresh.js";

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

describe("pi catalog refresh", () => {
  const home = useTempDir();
  const options = { env: {} };
  const ctx = () => ({ home: home.path });

  it("loads the models and the providers through the runtime and writes the cache", async () => {
    const catalog = await refreshPiCatalog(fakeRuntime(true), ctx(), options);
    expect(catalog.models).toEqual([
      { provider: "acme", modelId: "fast-1", name: "Fast One", thinkingLevels: ["off"] },
    ]);
    expect(catalog.providers).toMatchObject([{ id: "acme", methods: ["api_key"], configured: true }]);
    expect(await readPiCatalog(ctx(), options)).toEqual({ ...catalog, fresh: true });
  });

  it("answers from a fresh cache without a call to the loader", async () => {
    await refreshPiCatalog(fakeRuntime(true), ctx(), options);
    const loader = vi.fn(async () => fakeRuntime(false));
    expect((await loadPiCatalog(loader, ctx(), options)).providers[0]?.configured).toBe(true);
    expect(await piProviderReady(loader, ctx())).toBe(true);
    expect(loader).not.toHaveBeenCalled();
  });

  it("loads through the loader and refreshes a stale or missing cache", async () => {
    const loader = vi.fn(async () => fakeRuntime(false));
    expect(await piProviderReady(loader, ctx())).toBe(false);
    expect(loader).toHaveBeenCalledOnce();
    expect((await readPiCatalog(ctx(), options))?.providers[0]?.configured).toBe(false);

    const old = await piCatalogKey(ctx(), { ...options, version: "0.0.1-old" });
    await writePiCatalog({ models: [], providers: [] }, old, ctx());
    expect(await piProviderReady(async () => fakeRuntime(true), ctx())).toBe(true);
    expect((await readPiCatalog(ctx(), options))?.fresh).toBe(true);
  });
});
