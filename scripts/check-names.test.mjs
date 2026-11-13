import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { findBadNames } from "./check-names.mjs";

describe("findBadNames", () => {
  it("accepts dash-case files, folders, dotfiles and extensions", () => {
    const paths = [
      "src/tui/components/button/button.test.tsx",
      "src/services/factory-manager/index.ts",
      "vitest.config.ts",
      ".github/workflows/ci.yml",
      ".gitignore",
      "skills/factory/scripts/commit-project.d.mts",
    ];

    assert.deepEqual(findBadNames(paths), []);
  });

  it("accepts uppercase meta files and the ignored paths", () => {
    const paths = [
      "README.md",
      "skills/factory/SKILL.md",
      "LICENSE.md",
      ".agents/skills/agentic-tui/SomeUpstreamFile.md",
      ".rowbly/stories/ROW-01.md",
      "stages/IN_REVIEW.md",
    ];

    assert.deepEqual(findBadNames(paths), []);
  });

  it("rejects camelCase, PascalCase and snake_case in files and folders", () => {
    const paths = [
      "src/tui/components/Button/index.ts",
      "src/fooBar.ts",
      "skills/rowbly_reference.md",
      "src/README/index.ts",
      "stages/nested/BACKLOG.md",
    ];

    assert.deepEqual(findBadNames(paths), paths);
  });
});
