import { readFile, rm, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import pkg from "../../../package.json" with { type: "json" };
import type { getAuthStatus, listAvailableModels } from "../agent-auth/agent-auth.js";
import { writeFileAtomic } from "../files/files.js";
import type { ServiceContext } from "../workspace/workspace.js";

/** The format version of the cache file. A different version reads as missing. */
const CACHE_VERSION = 1;

/** The models of all providers, with the thinking levels of each model. */
export type CatalogModels = Awaited<ReturnType<typeof listAvailableModels>>;

/** The providers, their login methods and their configured status. */
export type CatalogProviders = Awaited<ReturnType<typeof getAuthStatus>>;

/** The answers of Pi that the cache keeps. */
export interface PiCatalog {
  readonly models: CatalogModels;
  readonly providers: CatalogProviders;
}

/** A catalog from the cache file. `fresh` is false when the key of the file is not the current key. */
export interface CachedPiCatalog extends PiCatalog {
  readonly fresh: boolean;
}

/** The values that make a cache stale when one of them changes. */
export interface PiCatalogKey {
  /** The mtime of `<agentDir>/auth.json` in ms, or `null` when the file is missing. */
  readonly auth: number | null;
  /** The mtime of `<agentDir>/models.json` in ms, or `null` when the file is missing. */
  readonly models: number | null;
  /** The version of the Rowbly package, because a new Pi version can change the model list. */
  readonly rowbly: string;
}

/** The environment of the key. Tests replace it; the defaults are the process environment and the package. */
export interface PiCatalogOptions {
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly version?: string;
}

interface CacheFile extends PiCatalog {
  readonly version: number;
  readonly key: PiCatalogKey;
}

function homeDir(ctx: ServiceContext): string {
  return ctx.home ?? homedir();
}

/** Expands a leading `~` as Pi does. */
function expandTilde(path: string, home: string): string {
  if (path === "~") {
    return home;
  }

  return path.startsWith("~/") ? join(home, path.slice(2)) : path;
}

/** The Pi agent folder. A copy of the rule of Pi's `getAgentDir()`, so that Rowbly does not load Pi to get it. */
export function piAgentDir(ctx: ServiceContext = {}, options: PiCatalogOptions = {}): string {
  const dir = (options.env ?? process.env).PI_CODING_AGENT_DIR;

  return dir ? expandTilde(dir, homeDir(ctx)) : join(homeDir(ctx), ".pi", "agent");
}

/** The path of the cache file. It is outside `.rowbly/`, because it belongs to the user and not to a Project. */
export function piCatalogFile(ctx: ServiceContext = {}): string {
  return join(homeDir(ctx), ".cache", "rowbly", "pi-catalog.json");
}

function mtime(path: string): Promise<number | null> {
  return stat(path).then(
    (info) => info.mtimeMs,
    () => null,
  );
}

/** The current key of the cache. It reads only two file dates, not Pi. */
export async function piCatalogKey(ctx: ServiceContext = {}, options: PiCatalogOptions = {}): Promise<PiCatalogKey> {
  const dir = piAgentDir(ctx, options);
  const [auth, models] = await Promise.all([mtime(join(dir, "auth.json")), mtime(join(dir, "models.json"))]);

  return { auth, models, rowbly: options.version ?? pkg.version };
}

function sameKey(a: PiCatalogKey, b: PiCatalogKey): boolean {
  return a.auth === b.auth && a.models === b.models && a.rowbly === b.rowbly;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringList(value: unknown): boolean {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isTime(value: unknown): boolean {
  return value === null || typeof value === "number";
}

function isKey(value: unknown): value is PiCatalogKey {
  return isRecord(value) && isTime(value.auth) && isTime(value.models) && typeof value.rowbly === "string";
}

function isModel(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.provider === "string" &&
    typeof value.modelId === "string" &&
    typeof value.name === "string" &&
    isStringList(value.thinkingLevels)
  );
}

function isProvider(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    isStringList(value.methods) &&
    typeof value.configured === "boolean"
  );
}

function isCacheFile(value: unknown): value is CacheFile {
  return (
    isRecord(value) &&
    value.version === CACHE_VERSION &&
    isKey(value.key) &&
    Array.isArray(value.models) &&
    value.models.every(isModel) &&
    Array.isArray(value.providers) &&
    value.providers.every(isProvider)
  );
}

async function readCacheFile(path: string): Promise<CacheFile | undefined> {
  try {
    const value: unknown = JSON.parse(await readFile(path, "utf8"));

    return isCacheFile(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

/** Reads the cache. A missing, corrupt or old-format file gives `undefined`; a changed key gives a stale catalog. */
export async function readPiCatalog(
  ctx: ServiceContext = {},
  options: PiCatalogOptions = {},
): Promise<CachedPiCatalog | undefined> {
  const [file, key] = await Promise.all([readCacheFile(piCatalogFile(ctx)), piCatalogKey(ctx, options)]);

  if (!file) {
    return undefined;
  }

  return { models: file.models, providers: file.providers, fresh: sameKey(file.key, key) };
}

/** Writes the catalog atomically with the key that was current before Pi loaded it. */
export async function writePiCatalog(catalog: PiCatalog, key: PiCatalogKey, ctx: ServiceContext = {}): Promise<void> {
  const file: CacheFile = { version: CACHE_VERSION, key, models: catalog.models, providers: catalog.providers };

  await writeFileAtomic(piCatalogFile(ctx), `${JSON.stringify(file)}\n`);
}

/** Deletes the cache file, so that the next reader loads through Pi. A missing file is not an error. */
export async function deletePiCatalog(ctx: ServiceContext = {}): Promise<void> {
  await rm(piCatalogFile(ctx), { force: true });
}
