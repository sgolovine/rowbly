import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import { useTestProject } from "./services/test-project/test-project.js";

// The CLI path must not load the TUI. A load of Ink or React during a command fails the test.
vi.mock("ink", () => {
  throw new Error("Ink loaded on the CLI path");
});
vi.mock("react", () => {
  throw new Error("React loaded on the CLI path");
});
vi.mock("react/jsx-runtime", () => {
  throw new Error("React loaded on the CLI path");
});

/** Gives the module specifiers of the static imports and re-exports in a source text. */
function staticImports(source: string): string[] {
  const pattern = /^\s*(?:import|export)\s+(?:[^"';]*?\s+from\s+)?["']([^"']+)["']/gm;

  return [...source.matchAll(pattern)].map((match) => match[1] as string);
}

describe("TUI import boundary", () => {
  const project = useTestProject();

  it("has only node: built-ins and the compile cache in the static imports of src/cli.ts", async () => {
    // Do not import src/cli.ts here: it loads the CLI, which parses process.argv at import time.
    const source = await readFile(new URL("./cli.ts", import.meta.url), "utf8");
    const imports = staticImports(source);

    expect(imports.filter((specifier) => !specifier.startsWith("node:"))).toEqual([
      "./services/compile-cache/compile-cache.js",
    ]);
    expect(source).toMatch(/await import\("\.\/cli-main\.js"\)/);
    expect(source.indexOf("enableRowblyCompileCache();")).toBeGreaterThan(-1);
    expect(source.indexOf("enableRowblyCompileCache();")).toBeLessThan(source.indexOf("await import("));
  });

  it("has no static import of Ink, React or the TUI in src/cli-main.ts", async () => {
    // Do not import src/cli-main.ts here: it parses process.argv and runs at import time.
    const source = await readFile(new URL("./cli-main.ts", import.meta.url), "utf8");
    const imports = staticImports(source);

    expect(imports).toContain("commander");
    expect(
      imports.filter((specifier) => /^(ink|react)(\/|$)/.test(specifier) || specifier.startsWith("./tui/")),
    ).toEqual([]);
    // React loads its production bundles, because the helper sets NODE_ENV only for the load of the TUI.
    expect(source).toMatch(/await loadInProductionMode\(\(\) => import\("\.\/tui\/index\.js"\)\)/);
  });

  it("finds a static import of the TUI", () => {
    expect(staticImports('import { renderTui } from "./tui/index.js";\nimport "ink";')).toEqual([
      "./tui/index.js",
      "ink",
    ]);
  });

  it("does not load Ink or React for help or command registration", async () => {
    const { createProgram } = await import("./commands/test-cli/test-cli.js");
    expect(createProgram().helpInformation()).toContain("Usage:");
  });

  it("gets a story without loading Ink or React", async () => {
    const { runCli } = await import("./commands/test-cli/test-cli.js");
    expect((await runCli(["story", "create", "--title", "First"], project.paths.root)).exitCode).toBe(0);
    const result = await runCli(["--json", "story", "get", "ROW-01"], project.paths.root);
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ id: "ROW-01", title: "First" });
  });

  it("reads the project status without loading Ink or React", async () => {
    const { runCli } = await import("./commands/test-cli/test-cli.js");
    const result = await runCli(["--json", "status"], project.paths.root);
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout).factory.phase).toBe("stopped");
  });
});
