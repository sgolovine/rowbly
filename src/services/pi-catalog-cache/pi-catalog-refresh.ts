import { type AuthRuntime, getAuthStatus, listAvailableModels } from "../agent-auth/agent-auth.js";
import type { ServiceContext } from "../workspace/workspace.js";
import {
  type PiCatalog,
  type PiCatalogOptions,
  piCatalogKey,
  readPiCatalog,
  writePiCatalog,
} from "./pi-catalog-cache.js";

/**
 * Loads the models and the providers through the runtime and writes them to the cache. The key is read before
 * the load, so that a change of the credentials during the load makes the cache stale. A failed write does not
 * fail the load, because the cache only makes the next view faster.
 */
export async function refreshPiCatalog(
  runtime: AuthRuntime,
  ctx: ServiceContext = {},
  options: PiCatalogOptions = {},
): Promise<PiCatalog> {
  const key = await piCatalogKey(ctx, options);
  const [providers, models] = await Promise.all([getAuthStatus(runtime), listAvailableModels(runtime)]);
  const catalog: PiCatalog = { models, providers };

  await writePiCatalog(catalog, key, ctx).catch(() => {});

  return catalog;
}

/** Gives the fresh cache, or loads Pi with `loadRuntime` and refreshes the cache when it is stale or missing. */
export async function loadPiCatalog(
  loadRuntime: () => Promise<AuthRuntime>,
  ctx: ServiceContext = {},
  options: PiCatalogOptions = {},
): Promise<PiCatalog> {
  const cached = await readPiCatalog(ctx, options);

  if (cached?.fresh) {
    return cached;
  }

  return refreshPiCatalog(await loadRuntime(), ctx, options);
}

/** True when Pi has a provider with credentials or a key. It loads Pi only when the cache is stale or missing. */
export async function piProviderReady(
  loadRuntime: () => Promise<AuthRuntime>,
  ctx: ServiceContext = {},
): Promise<boolean> {
  return (await loadPiCatalog(loadRuntime, ctx)).providers.some((provider) => provider.configured);
}
