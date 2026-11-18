import { constants, type EnableCompileCacheResult, enableCompileCache } from "node:module";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

/** The inputs of the compile cache function. Tests inject them. */
export interface CompileCacheDeps {
  readonly env: NodeJS.ProcessEnv;
  readonly platform: NodeJS.Platform;
  readonly home: () => string;
  readonly enableCompileCache: (directory?: string) => EnableCompileCacheResult;
}

const defaultDeps: CompileCacheDeps = {
  env: process.env,
  platform: process.platform,
  home: homedir,
  enableCompileCache,
};

/** Gives the user cache directory of the platform, or `undefined` if there is no home directory. */
function userCacheDir(deps: Pick<CompileCacheDeps, "env" | "platform" | "home">): string | undefined {
  const { env, platform } = deps;
  const xdg = env.XDG_CACHE_HOME;

  if (xdg && isAbsolute(xdg)) {
    return xdg;
  }

  if (platform === "win32" && env.LOCALAPPDATA) {
    return env.LOCALAPPDATA;
  }

  const home = deps.home();

  if (!home) {
    return undefined;
  }

  return platform === "darwin" ? join(home, "Library", "Caches") : join(home, ".cache");
}

/** Gives the compile cache directory of Rowbly, or `undefined` if there is no user cache directory. */
function compileCacheDir(deps: Pick<CompileCacheDeps, "env" | "platform" | "home">): string | undefined {
  const base = userCacheDir(deps);

  return base === undefined ? undefined : join(base, "rowbly", "compile-cache");
}

function failed(message: string): EnableCompileCacheResult {
  return { status: constants.compileCacheStatus.FAILED, message };
}

function enableWithDeps(deps: CompileCacheDeps): EnableCompileCacheResult {
  // The user controls the cache with these variables. Node reads them, so Rowbly does not override them.
  if (deps.env.NODE_DISABLE_COMPILE_CACHE) {
    return { status: constants.compileCacheStatus.DISABLED };
  }

  if (deps.env.NODE_COMPILE_CACHE) {
    return deps.enableCompileCache();
  }

  const directory = compileCacheDir(deps);

  return directory === undefined ? failed("No user cache directory") : deps.enableCompileCache(directory);
}

/**
 * Turns on the Node compile cache in the Rowbly cache directory.
 * The cache is only a performance aid: the function never throws and never writes output.
 */
export function enableRowblyCompileCache(overrides: Partial<CompileCacheDeps> = {}): EnableCompileCacheResult {
  try {
    return enableWithDeps({ ...defaultDeps, ...overrides });
  } catch (error) {
    return failed(error instanceof Error ? error.message : String(error));
  }
}
