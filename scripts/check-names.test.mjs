import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { findBadNames, isGoodRouteSegment } from "./check-names.mjs";

describe("findBadNames", () => {
  it("accepts dash-case files, folders, dotfiles and extensions", () => {
    const paths = [
      "packages/cli/src/tui/components/button/button.test.tsx",
      "packages/cli/src/services/factory-manager/index.ts",
      "packages/cli/vitest.config.ts",
      ".github/workflows/ci.yml",
      ".gitignore",
      "packages/cli/skills/factory/scripts/commit-project.d.mts",
    ];

    assert.deepEqual(findBadNames(paths), []);
  });

  it("accepts uppercase meta files and the ignored paths", () => {
    const paths = [
      "README.md",
      "packages/cli/skills/factory/SKILL.md",
      "LICENSE.md",
      ".agents/skills/agentic-tui/SomeUpstreamFile.md",
      ".rowbly/stories/ROW-01.md",
      "packages/cli/stages/IN_REVIEW.md",
      "packages/cli/src/config/prompts/SYSTEM.md",
      "packages/website/public/CNAME",
    ];

    assert.deepEqual(findBadNames(paths), []);
  });

  it("rejects camelCase, PascalCase and snake_case in files and folders", () => {
    const paths = [
      "packages/cli/src/tui/components/Button/index.ts",
      "packages/cli/src/fooBar.ts",
      "packages/cli/skills/rowbly_reference.md",
      "packages/cli/src/README/index.ts",
      "packages/cli/stages/nested/BACKLOG.md",
    ];

    assert.deepEqual(findBadNames(paths), paths);
  });

  it("rejects the stage and prompt names outside packages/cli/", () => {
    const paths = ["stages/IN_REVIEW.md", "src/config/prompts/SYSTEM.md", "packages/website/stages/IN_REVIEW.md"];

    assert.deepEqual(findBadNames(paths), paths);
  });
});

const ROUTES = "packages/website/src/routes";

// One example for each TanStack Router name form.
const ROUTE_EXAMPLES = [
  "__root.tsx",
  "$story-key.tsx",
  "$.tsx",
  "_marketing.tsx",
  "_marketing/index.tsx",
  "posts_.tsx",
  "posts.$post-id_.edit.tsx",
  "-components/header.tsx",
  "-helpers.ts",
  "(legal)/terms.tsx",
  "how-it-works.index.tsx",
  "script[.]js.tsx",
  "route.tsx",
  "index.lazy.tsx",
  "posts/route.lazy.tsx",
  "{-$locale}/about.tsx",
];

describe("findBadNames in packages/website/src/routes/", () => {
  it("accepts each TanStack Router name form", () => {
    const paths = [
      ...ROUTE_EXAMPLES.map((example) => `${ROUTES}/${example}`),
      `${ROUTES}/(legal)/_marketing/$story-key.tsx`,
      `${ROUTES}/README.md`,
    ];

    assert.deepEqual(findBadNames(paths), []);
  });

  it("rejects a word that is not dash-case inside a route form", () => {
    const paths = [
      `${ROUTES}/$storyKey.tsx`,
      `${ROUTES}/__Root.tsx`,
      `${ROUTES}/My_Page.tsx`,
      `${ROUTES}/(Legal)/terms.tsx`,
      `${ROUTES}/posts.Edit.tsx`,
      `${ROUTES}/-Components/header.tsx`,
      `${ROUTES}/__root/index.tsx`,
      `${ROUTES}/(legal).tsx`,
      `${ROUTES}/{$locale}.tsx`,
      `${ROUTES}/locale}.tsx`,
      `${ROUTES}/posts..tsx`,
    ];

    assert.deepEqual(findBadNames(paths), paths);
  });

  // Dot-separated names such as `how-it-works.index.tsx` are already good outside the routes folder.
  it("rejects the route forms outside packages/website/src/routes/", () => {
    const paths = [
      "packages/cli/src/__root.tsx",
      "packages/cli/src/$story-key.tsx",
      "packages/cli/src/$.tsx",
      "packages/cli/src/_marketing.tsx",
      "packages/cli/src/_marketing/index.tsx",
      "packages/cli/src/posts_.tsx",
      "packages/cli/src/-components/header.tsx",
      "packages/cli/src/(legal)/terms.tsx",
      "packages/cli/src/script[.]js.tsx",
      "packages/cli/src/{-$locale}/about.tsx",
      "packages/website/src/components/__root.tsx",
      "website/src/routes/$story-key.tsx",
      "routes/$story-key.tsx",
    ];

    assert.deepEqual(findBadNames(paths), paths);
  });
});

describe("isGoodRouteSegment", () => {
  it("removes the extension only from a file", () => {
    assert.equal(isGoodRouteSegment("index.lazy.tsx", true), true);
    assert.equal(isGoodRouteSegment("posts.$post-id", false), true);
    assert.equal(isGoodRouteSegment("__root", false), false);
  });
});
