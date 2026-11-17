import { type AuthRuntime, getAuthStatus, listAvailableModels } from "../agent-auth/agent-auth.js";
import type { ServiceContext } from "../workspace/workspace.js";
import {
  type CatalogModels,
  type CatalogProviders,
  type PiCatalog,
  type PiCatalogOptions,
  piCatalogKey,
  readPiCatalog,
  writePiCatalog,
} from "./pi-catalog-cache.js";

/** The two reads of Pi that the catalog needs. The Pi worker or a main-thread runtime gives them. */
export interface PiCatalogSource {
  listAvailableModels(): Promise<CatalogModels>;
  getAuthStatus(): Promise<CatalogProviders>;
}

/** Reads the catalog through a runtime of this thread, for example the runtime of the AI settings. */
export function runtimeSource(runtime: AuthRuntime): PiCatalogSource {
  return {
    listAvailableModels: () => listAvailableModels(runtime),
    getAuthStatus: () => getAuthStatus(runtime),
  };
}

/**
 * Loads the models and the providers through the source and writes them to the cache. The key is read before
 * the load, so that a change of the credentials during the load makes the cache stale. A failed write does not
 * fail the load, because the cache only makes the next view faster.
 */
export async function refreshPiCatalog(
  source: PiCatalogSource,
  ctx: ServiceContext = {},
  options: PiCatalogOptions = {},
): Promise<PiCatalog> {
  const key = await piCatalogKey(ctx, options);
  const [providers, models] = await Promise.all([source.getAuthStatus(), source.listAvailableModels()]);
  const catalog: PiCatalog = { models, providers };

  await writePiCatalog(catalog, key, ctx).catch(() => {});

  return catalog;
}

/** Gives the fresh cache, or reads the source and refreshes the cache when it is stale or missing. */
export async function loadPiCatalog(
  source: PiCatalogSource,
  ctx: ServiceContext = {},
  options: PiCatalogOptions = {},
): Promise<PiCatalog> {
  const cached = await readPiCatalog(ctx, options);

  if (cached?.fresh) {
    return cached;
  }

  return refreshPiCatalog(source, ctx, options);
}

/** True when Pi has a provider with credentials or a key. It reads the source only when the cache is stale or missing. */
export async function piProviderReady(source: PiCatalogSource, ctx: ServiceContext = {}): Promise<boolean> {
  return (await loadPiCatalog(source, ctx)).providers.some((provider) => provider.configured);
}
