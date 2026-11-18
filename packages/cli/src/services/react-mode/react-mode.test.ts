import { execFile } from "node:child_process";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { loadInProductionMode } from "./react-mode.js";

const exec = promisify(execFile);
const repo = resolve(".");
const tsxLoader = pathToFileURL(join(repo, "node_modules/tsx/dist/loader.mjs")).href;
const helperUrl = pathToFileURL(join(repo, "src/services/react-mode/react-mode.ts")).href;

// The child loads React and Ink through the helper, as the TUI does. Ink loads the React reconciler, which is not
// a direct dependency of Rowbly. Then the child prints the loaded CommonJS bundles and the final NODE_ENV. The
// export lexer of Node adds the files of both branches of `index.js` to the cache, so only a module that ran counts.
const childScript = `
import { createRequire } from "node:module";
const { loadInProductionMode } = await import(${JSON.stringify(helperUrl)});
const before = process.env.NODE_ENV;
await loadInProductionMode(async () => {
  await import("react");
  await import("ink");
});
const require = createRequire(import.meta.url);
const bundles = Object.entries(require.cache)
  .filter(([, module]) => module?.loaded)
  .map(([path]) => path.replaceAll("\\\\", "/").match(/\\/(react|react-reconciler)\\/cjs\\/([^/]+\\.js)$/))
  .filter(Boolean)
  .map((match) => match[1] + "/cjs/" + match[2])
  .sort();
console.log(JSON.stringify({ before: before ?? null, after: process.env.NODE_ENV ?? null, bundles }));
`;

interface ChildResult {
  readonly before: string | null;
  readonly after: string | null;
  readonly bundles: readonly string[];
}

async function runChild(nodeEnv: string | undefined): Promise<ChildResult> {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== "NODE_ENV"));
  const childEnv = nodeEnv === undefined ? env : { ...env, NODE_ENV: nodeEnv };
  const { stdout } = await exec(
    process.execPath,
    ["--import", tsxLoader, "--input-type=module", "--eval", childScript],
    { cwd: repo, env: childEnv },
  );

  return JSON.parse(stdout.trim()) as ChildResult;
}

describe("loadInProductionMode in a child process", () => {
  it("loads the production bundles and removes NODE_ENV again when NODE_ENV is not set", async () => {
    const result = await runChild(undefined);

    expect(result.before).toBeNull();
    expect(result.after).toBeNull();
    expect(result.bundles).toContain("react/cjs/react.production.js");
    expect(result.bundles).toContain("react-reconciler/cjs/react-reconciler.production.js");
    expect(result.bundles.filter((bundle) => bundle.includes(".development."))).toEqual([]);
  }, 30_000);

  it("keeps a NODE_ENV of the user and loads the bundles for that value", async () => {
    const result = await runChild("development");

    expect(result.before).toBe("development");
    expect(result.after).toBe("development");
    expect(result.bundles).toContain("react/cjs/react.development.js");
    expect(result.bundles).toContain("react-reconciler/cjs/react-reconciler.development.js");
    expect(result.bundles.filter((bundle) => bundle.includes(".production."))).toEqual([]);
  }, 30_000);
});

describe("loadInProductionMode in this process", () => {
  const original = process.env.NODE_ENV;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = original;
    }
  });

  it("sets production only during the load and removes it after the load", async () => {
    delete process.env.NODE_ENV;

    const seen = await loadInProductionMode(async () => process.env.NODE_ENV);

    expect(seen).toBe("production");
    expect("NODE_ENV" in process.env).toBe(false);
  });

  it("removes NODE_ENV also when the load fails", async () => {
    delete process.env.NODE_ENV;

    await expect(
      loadInProductionMode(async () => {
        throw new Error("load failed");
      }),
    ).rejects.toThrow("load failed");
    expect("NODE_ENV" in process.env).toBe(false);
  });

  it("does not change a NODE_ENV of the user", async () => {
    process.env.NODE_ENV = "development";

    const seen = await loadInProductionMode(async () => process.env.NODE_ENV);

    expect(seen).toBe("development");
    expect(process.env.NODE_ENV).toBe("development");
  });
});
