---
title: Accept TanStack Router file names in the lint checks
stage: IN_REFINEMENT
position: 3
worktree: null
pull_request: null
---

## Goal

Update the repository lint rules so that they accept the file names of TanStack Router file-based routes in `website/src/routes/`. The website then gets the same root lint checks as the rest of the repository. Do not exclude `website/` from the root checks.

## Scope

TanStack Router gives a meaning to some characters in route file and folder names. The current checks reject these names:

- `scripts/check-names.mjs` requires dash-case for each path segment (`^[a-z0-9]+(-[a-z0-9]+)*$` on the part before the first dot).
- Biome `style/useFilenamingConvention` requires `kebab-case` for script files.

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

- Each word inside these forms must still be dash-case. For example, `$storyKey.tsx` and `__Root.tsx` stay errors.
- The generated `website/src/route-tree.gen.ts` (or `routeTree.gen.ts`, the TanStack default) is not a source file. Prefer the config option `generatedRouteTree: "./src/route-tree.gen.ts"` so that the name is dash-case. If you keep the default name, ignore the file in Biome and in `check-names.mjs`, and write the reason in a comment.
- Outside `website/src/routes/`, keep the current dash-case rule without change.
- In Biome, add an `overrides` entry for `website/src/routes/**` that relaxes `useFilenamingConvention` only as much as necessary (for example with its `match` option, or by turning it off there and depending on `check-names.mjs`). Write a comment that tells why.
- Keep the strict style plugins (`biome-plugins/*.grit`) scoped to `src/**`, as now.

## Acceptance criteria

- [ ] `findBadNames` accepts every example in the table when the path is under `website/src/routes/`.
- [ ] `findBadNames` rejects the same names outside `website/src/routes/`, and rejects `$storyKey.tsx`, `__Root.tsx` and `My_Page.tsx` inside it.
- [ ] `scripts/check-names.test.mjs` covers each form in the table, the bad examples and a path outside the routes folder.
- [ ] Biome accepts a route file such as `website/src/routes/__root.tsx` and still rejects `website/src/components/MyButton.tsx`.
- [ ] `docs/contributing/lint-rules.md` and `docs/architecture/tooling.md` describe the TanStack exception, in STE.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build` pass.

## Technical notes

Do this Story before ROW-45 (the website scaffold), or in the same branch as its first commit. ROW-45 depends on it.
`scripts/check-names.mjs` already has `IGNORED_PATHS` and `META_FILES`; add a separate, tested function for route segments instead of a broad ignore pattern.
Check the TanStack Router "File naming conventions" docs for the current list of forms before you implement.
