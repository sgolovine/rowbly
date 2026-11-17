import { readdir, readFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The CLI commands and the services must not load the TUI. Only `rowbly` with no arguments loads it.
const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tuiRoot = join(sourceRoot, "tui");
const scannedFolders = ["commands", "services"];

/** Gives the module specifiers of the static imports and re-exports in a source text. */
function staticImports(source: string): string[] {
  const pattern = /^\s*(?:import|export)\s+(?:[^"';]*?\s+from\s+)?["']([^"']+)["']/gm;

  return [...source.matchAll(pattern)].map((match) => match[1] as string);
}

/** Tells if a specifier in the file at `filePath` loads Ink, React, an Ink package or a TUI module. */
function isForbidden(specifier: string, filePath: string): boolean {
  if (/^(ink|react)(\/|$)/.test(specifier) || /^ink-[^/]+/.test(specifier)) {
    return true;
  }
  if (!specifier.startsWith(".")) {
    return false;
  }
  const target = resolve(dirname(filePath), specifier);
  return target === tuiRoot || target.startsWith(`${tuiRoot}${sep}`);
}

/** Gives the forbidden specifiers in a source text. */
function forbiddenImports(source: string, filePath: string): string[] {
  return staticImports(source).filter((specifier) => isForbidden(specifier, filePath));
}

/** Gives each non-test `.ts` and `.tsx` file in a folder and its subfolders. */
async function sourceFiles(folder: string): Promise<string[]> {
  const entries = await readdir(folder, { recursive: true, withFileTypes: true });

  return entries
    .filter((entry) => entry.isFile() && /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name))
    .map((entry) => join(entry.parentPath, entry.name));
}

describe("TUI import boundary of commands and services", () => {
  it("has no static import of Ink, React or the TUI in src/commands/ or src/services/", async () => {
    const files = (await Promise.all(scannedFolders.map((folder) => sourceFiles(join(sourceRoot, folder))))).flat();
    const violations = await Promise.all(
      files.map(async (file) =>
        forbiddenImports(await readFile(file, "utf8"), file).map(
          (specifier) => `${relative(sourceRoot, file)}: ${specifier}`,
        ),
      ),
    );

    expect(files.length).toBeGreaterThan(50);
    expect(violations.flat()).toEqual([]);
  });

  it("finds each kind of forbidden import in a sample text", () => {
    const file = join(sourceRoot, "commands", "story", "story.ts");
    const sample = [
      'import { render } from "ink";',
      'import { useState } from "react";',
      'import { jsx } from "react/jsx-runtime";',
      'import TextInput from "ink-text-input";',
      'import { renderTui } from "../../tui/index.js";',
      "export {",
      "  theme,",
      '} from "../../tui/theme/theme.js";',
      'import type { Story } from "../../services/story/story.js";',
      'import { Command } from "commander";',
      'import { inkwell } from "./inkwell.js";',
      'import { reactor } from "reactor";',
    ].join("\n");

    expect(forbiddenImports(sample, file)).toEqual([
      "ink",
      "react",
      "react/jsx-runtime",
      "ink-text-input",
      "../../tui/index.js",
      "../../tui/theme/theme.js",
    ]);
  });

  it("does not flag a relative path that only has a similar name", () => {
    const file = join(sourceRoot, "services", "story", "story.ts");
    expect(forbiddenImports('import { a } from "../tui-like/a.js";', file)).toEqual([]);
    expect(forbiddenImports('import { a } from "../../tui/a.js";', file)).toEqual(["../../tui/a.js"]);
  });
});
