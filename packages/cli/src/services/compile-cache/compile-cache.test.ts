import { constants } from "node:module";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { type CompileCacheDeps, enableRowblyCompileCache } from "./compile-cache.js";

const { ENABLED, FAILED, DISABLED, ALREADY_ENABLED } = constants.compileCacheStatus;
const home = () => "/home/user";

/** Gives the directory that the function passes to `enableCompileCache`. */
function cacheDir(deps: Pick<CompileCacheDeps, "env" | "platform" | "home">): string | undefined {
  const enable = vi.fn((_directory?: string) => ({ status: ENABLED }));

  enableRowblyCompileCache({ ...deps, enableCompileCache: enable });

  return enable.mock.calls[0]?.[0];
}

/** Gives the user cache directory that the function selects. */
function userCacheDir(deps: Pick<CompileCacheDeps, "env" | "platform" | "home">): string | undefined {
  const dir = cacheDir(deps);

  return dir === undefined ? undefined : join(dir, "..", "..");
}

describe("cache directory", () => {
  it("uses an absolute XDG_CACHE_HOME on each platform", () => {
    for (const platform of ["linux", "darwin", "win32"] as const) {
      expect(userCacheDir({ env: { XDG_CACHE_HOME: "/xdg", LOCALAPPDATA: "/local" }, platform, home })).toBe("/xdg");
    }
  });

  it("ignores a relative XDG_CACHE_HOME", () => {
    expect(userCacheDir({ env: { XDG_CACHE_HOME: "relative/cache" }, platform: "linux", home })).toBe(
      join("/home/user", ".cache"),
    );
  });

  it("uses ~/Library/Caches on macOS", () => {
    expect(userCacheDir({ env: {}, platform: "darwin", home })).toBe(join("/home/user", "Library", "Caches"));
  });

  it("uses LOCALAPPDATA on Windows when it is set", () => {
    expect(userCacheDir({ env: { LOCALAPPDATA: "/appdata/local" }, platform: "win32", home })).toBe("/appdata/local");
    expect(userCacheDir({ env: {}, platform: "win32", home })).toBe(join("/home/user", ".cache"));
  });

  it("uses ~/.cache on other systems", () => {
    expect(userCacheDir({ env: {}, platform: "linux", home })).toBe(join("/home/user", ".cache"));
    expect(userCacheDir({ env: {}, platform: "freebsd", home })).toBe(join("/home/user", ".cache"));
  });

  it("gives undefined without a home directory", () => {
    expect(userCacheDir({ env: {}, platform: "linux", home: () => "" })).toBeUndefined();
  });

  it("puts the compile cache in rowbly/compile-cache", () => {
    expect(cacheDir({ env: { XDG_CACHE_HOME: "/xdg" }, platform: "linux", home })).toBe(
      join("/xdg", "rowbly", "compile-cache"),
    );
  });
});

describe("enableRowblyCompileCache", () => {
  it("enables the cache in the Rowbly directory", () => {
    const enable = vi.fn(() => ({ status: ENABLED, directory: "/xdg/rowbly/compile-cache" }));
    const result = enableRowblyCompileCache({
      env: { XDG_CACHE_HOME: "/xdg" },
      platform: "linux",
      home,
      enableCompileCache: enable,
    });

    expect(enable).toHaveBeenCalledWith(join("/xdg", "rowbly", "compile-cache"));
    expect(result).toEqual({ status: ENABLED, directory: "/xdg/rowbly/compile-cache" });
  });

  it("returns a FAILED result from Node", () => {
    const enable = vi.fn(() => ({ status: FAILED, message: "Cannot create cache directory: permission denied" }));

    expect(enableRowblyCompileCache({ env: {}, platform: "linux", home, enableCompileCache: enable })).toEqual({
      status: FAILED,
      message: "Cannot create cache directory: permission denied",
    });
  });

  it("does not throw when enableCompileCache throws", () => {
    const enable = vi.fn(() => {
      throw new Error("boom");
    });

    expect(enableRowblyCompileCache({ env: {}, platform: "linux", home, enableCompileCache: enable })).toEqual({
      status: FAILED,
      message: "boom",
    });
  });

  it("does not throw when the home directory is not available", () => {
    const enable = vi.fn();
    const result = enableRowblyCompileCache({
      env: {},
      platform: "linux",
      home: () => {
        throw new Error("no home");
      },
      enableCompileCache: enable,
    });

    expect(result).toEqual({ status: FAILED, message: "no home" });
    expect(enable).not.toHaveBeenCalled();
  });

  it("does not pass its own directory when NODE_COMPILE_CACHE is set", () => {
    const enable = vi.fn(() => ({ status: ALREADY_ENABLED, directory: "/custom" }));
    const result = enableRowblyCompileCache({
      env: { NODE_COMPILE_CACHE: "/custom", XDG_CACHE_HOME: "/xdg" },
      platform: "linux",
      home,
      enableCompileCache: enable,
    });

    expect(enable).toHaveBeenCalledWith();
    expect(result.status).toBe(ALREADY_ENABLED);
  });

  it("keeps the cache off when NODE_DISABLE_COMPILE_CACHE is set", () => {
    const enable = vi.fn();
    const result = enableRowblyCompileCache({
      env: { NODE_DISABLE_COMPILE_CACHE: "1" },
      platform: "linux",
      home,
      enableCompileCache: enable,
    });

    expect(enable).not.toHaveBeenCalled();
    expect(result.status).toBe(DISABLED);
  });
});
