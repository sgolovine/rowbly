import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { findBadNames, isGoodRouteSegment } from "./check-names.mjs";

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
      "website/public/CNAME",
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

const ROUTES = "website/src/routes";

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

describe("findBadNames in website/src/routes/", () => {
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
  it("rejects the route forms outside website/src/routes/", () => {
    const paths = [
      "src/__root.tsx",
      "src/$story-key.tsx",
      "src/$.tsx",
      "src/_marketing.tsx",
      "src/_marketing/index.tsx",
      "src/posts_.tsx",
      "src/-components/header.tsx",
      "src/(legal)/terms.tsx",
      "src/script[.]js.tsx",
      "src/{-$locale}/about.tsx",
      "website/src/components/__root.tsx",
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
