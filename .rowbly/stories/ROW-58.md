---
title: Accept TanStack Router file names in the lint checks
stage: IN_REVIEW
position: 2
worktree: /home/sgolovine/Projects/rowbly-worktrees/ROW-58
pull_request: https://github.com/sgolovine/rowbly/pull/240
---

## Goal

Update the repository lint rules so that they accept the file names of TanStack Router file-based routes in `website/src/routes/`. The website then gets the same root lint checks as the rest of the repository. Do not exclude `website/` from the root checks.

## Scope

TanStack Router gives a meaning to some characters in route file and folder names. The current checks reject these names:

- `scripts/check-names.mjs` requires dash-case for each path segment (`^[a-z0-9]+(-[a-z0-9]+)*$` on the part before the first dot).
- Biome `style/useFilenamingConvention` (Biome 2.6.5, `filenameCases: ["kebab-case"]`) requires `kebab-case` for script files.

Accept these route name forms, only under `website/src/routes/`:

| Form | Example | Meaning |
| --- | --- | --- |
| `__root` | `__root.tsx` | The root route |
| `$name` | `$story-key.tsx` | A path parameter |
| `$` | `$.tsx` | A splat (catch-all) route |
| `_name` | `_marketing.tsx`, `_marketing/` | A pathless layout route |
| `name_` | `posts_.tsx` | A non-nested route |
| `-name` | `-components/` | A file or folder that the router ignores |
| `(name)` | `(legal)/` | A route group folder |
| `a.b.c` | `how-it-works.index.tsx` | Flat routes: each dot separates two route segments |
| `[x]` | `script[.]js.tsx` | An escaped character |
| `index`, `route`, `lazy` | `route.tsx`, `index.lazy.tsx` | Special route file names |

Rules:

- Each word inside these forms must still be dash-case. For example, `$storyKey.tsx`, `__Root.tsx` and `My_Page.tsx` stay errors.
- The generated route tree is not a source file. Prefer the config option `generatedRouteTree: "./src/route-tree.gen.ts"` so that the name is dash-case. If you keep the default name `routeTree.gen.ts`, ignore the file in Biome and in `check-names.mjs`, and write the reason in a comment.
- Outside `website/src/routes/`, keep the current dash-case rule without change.
- In Biome, add an `overrides` entry for `website/src/routes/**` that relaxes `useFilenamingConvention` only as much as necessary (for example with its `match` option, or by turning it off there and depending on `check-names.mjs`). Write a comment that tells why.
- Keep the strict style plugins (`biome-plugins/*.grit`) scoped to `src/**`, as now.

Not in scope:

- The website itself, its `package.json`, the TanStack Router config file and real route files. ROW-45 creates them.
- Changes to the dash-case rule outside `website/src/routes/`.

## Acceptance criteria

- [ ] `findBadNames` accepts every example in the table when the path is under `website/src/routes/` (for example `website/src/routes/(legal)/_marketing/$story-key.tsx`).
- [ ] `findBadNames` rejects the same names outside `website/src/routes/` (for example `src/$story-key.tsx`, `website/src/components/__root.tsx`), and rejects `$storyKey.tsx`, `__Root.tsx` and `My_Page.tsx` inside it.
- [ ] `scripts/check-names.test.mjs` covers each form in the table, the bad examples and a path outside the routes folder. `node --test scripts/*.test.mjs` passes.
- [ ] `echo 'export {};' | pnpm exec biome lint --stdin-file-path=website/src/routes/__root.tsx` reports no `useFilenamingConvention` error, and the same command with `--stdin-file-path=website/src/components/MyButton.tsx` reports a `useFilenamingConvention` error.
- [ ] `biome.json` has a comment that tells why the `website/src/routes/**` override exists.
- [ ] `docs/contributing/lint-rules.md` and the "Name check" section of `docs/architecture/tooling.md` describe the TanStack exception, in STE.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build` pass.

## Technical notes

- Do this Story before ROW-45 (the website scaffold), or in the same branch as its first commit. ROW-45 depends on it.
- `scripts/check-names.mjs` already has `IGNORED_PATHS` and `META_FILES`. Add a separate, exported and tested function for route segments (for example `isGoodRouteSegment(segment, isFile)`) instead of a broad ignore pattern. `isGoodPath` calls it for each segment after the `website/src/routes/` prefix.
- The current `baseName` keeps only the part before the first dot. For route files, remove the file extension (`.tsx`, `.ts`), then split the rest on dots that are not inside `[...]`, and check each part. Accept `lazy` as the last part before the extension.
- Biome 2 `useFilenamingConvention` has a `match` option (a regex with capture groups that Biome checks for the case). Biome treats `biome.json` as JSONC, so comments are allowed. If `match` cannot express all forms, set the rule to `off` in the override and depend on `check-names.mjs`.
- Check the TanStack Router "File naming conventions" docs for the current list of forms before you implement. If the docs add a form that is not in the table, add it with a test.

## Assumptions

- The `website/` folder does not exist yet, so the Biome criteria use `biome lint --stdin-file-path` with paths that do not exist. Reason: this examines the override without a real website, and ROW-45 creates the real files.
- The route exception applies only to the exact prefix `website/src/routes/`, not to other `routes/` folders. Reason: smallest scope that agrees with the author's intent ("only under `website/src/routes/`").
- The extension of a route file is not part of the name check (for example `.tsx`, `.ts`). Reason: the current check also ignores all text after the first dot.
