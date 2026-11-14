import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { build } from "tsup";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pkg from "../package.json" with { type: "json" };
import { initProject } from "./services/project/project.js";

const exec = promisify(execFile);
const repo = resolve(".");
const tsxLoader = pathToFileURL(join(repo, "node_modules/tsx/dist/loader.mjs")).href;

interface Entry {
  readonly execArgv: readonly string[];
  readonly path: string;
}

/** Gives an environment without the compile cache variables of the parent, with the given cache home. */
function cacheEnv(cacheHome: string): NodeJS.ProcessEnv {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !["NODE_COMPILE_CACHE", "NODE_DISABLE_COMPILE_CACHE"].includes(key)),
  );

  return { ...env, XDG_CACHE_HOME: cacheHome };
}

async function run(entry: Entry, args: readonly string[], cacheHome: string, cwd: string) {
  return exec(process.execPath, [...entry.execArgv, entry.path, ...args], { cwd, env: cacheEnv(cacheHome) });
}

describe("startup with the compile cache", () => {
  let dir: string;
  let built: Entry;
  let project: string;
  let readOnly: string;
  const tsx: Entry = { execArgv: ["--import", tsxLoader], path: join(repo, "src/cli.ts") };

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "rowbly-startup-test-"));
    const pkg = join(dir, "package");
    await mkdir(pkg);
    await symlink(join(repo, "node_modules"), join(pkg, "node_modules"));
    await build({
      config: false,
      entry: [join(repo, "src/cli.ts")],
      outDir: join(pkg, "dist"),
      format: ["esm"],
      platform: "node",
      target: "node22",
      external: [
        "@earendil-works/pi-coding-agent",
        ...Object.keys(JSON.parse(await readFile(join(repo, "package.json"), "utf8")).dependencies),
      ],
      silent: true,
    });
    built = { execArgv: [], path: join(pkg, "dist/cli.js") };
    project = join(dir, "project");
    await mkdir(project);
    await initProject({ name: "Startup", key: "S" }, { cwd: project });
    readOnly = join(dir, "read-only-cache");
    await mkdir(readOnly);
    await chmod(readOnly, 0o555);
  }, 60_000);

  afterAll(async () => {
    await chmod(readOnly, 0o755).catch(() => {});
    await rm(dir, { recursive: true, force: true });
  });

  it("prints the version from the built entry and fills a writable cache", async () => {
    const cacheHome = join(dir, "writable-cache");
    const result = await run(built, ["--version"], cacheHome, project);

    expect(result.stdout.trim()).toBe(pkg.version);
    expect(result.stderr).toBe("");
    expect((await readdir(join(cacheHome, "rowbly", "compile-cache"))).length).toBeGreaterThan(0);
  }, 30_000);

  it.each(["built", "tsx"] as const)(
    "starts the %s entry with a cache directory that it cannot write",
    async (mode) => {
      const entry = mode === "built" ? built : tsx;
      const writable = join(dir, `writable-${mode}`);

      for (const args of [["--version"], ["--json", "status"]]) {
        const expected = await run(entry, args, writable, project);
        const actual = await run(entry, args, readOnly, project);

        expect(actual.stdout).toBe(expected.stdout);
        expect(actual.stderr).toBe("");
      }

      // A cache directory that Rowbly cannot create does not exist after the runs.
      await expect(readdir(join(readOnly, "rowbly"))).rejects.toThrow();
    },
    60_000,
  );
});
