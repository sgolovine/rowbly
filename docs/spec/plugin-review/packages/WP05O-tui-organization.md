# WP05O — TUI organization pass

**Depends on:** — · **Wave:** 0 · **Priority:** P2. Enabler for every later TUI package.
**Review sources:** [CQ-73](../../../reviews/plugin-architecture/code-quality.md#cq-73), [CQ-74](../../../reviews/plugin-architecture/code-quality.md#cq-74). The review requires these moves to happen "before other TUI line-based patches" so that later packages don't race them.

## Goal

Bring the core TUI screens in scope into line with AGENTS.md:

- one component per PascalCase file;
- area barrels;
- no cross-area deep imports.

Do it in one **mechanical** pass with no behavior change, so that WP05A, WP05B, WP05C, and the WP08 packages edit stable paths.

## Owns

- `src/tui/screens/stories/**`
- `src/tui/screens/home/**`
- `src/tui/screens/boards/BoardDetail.tsx` (rename only)
- `src/tui/screens/tasks/**` (imports only)
- `src/tui/screens/board/BoardScreen.tsx` (imports only)
- `src/tui/screens/stages/**` (barrel exports only)
- `src/tui/screens/plugins/**` (CQ-57 rename only, if selected)
- `src/tui/components/PluginSlot.tsx`
- the area `index.ts` barrels
- `src/tui/hooks/index.ts` and `src/tui/components/index.ts` (exports only)
- test import paths that point at moved files.

## Deliverables

1. **CQ-73 renames and splits:**
   - `stories/detail.tsx` → `StoryDetailScreen.tsx`
   - `stories/form.tsx` → `StoryFormScreen.tsx`
   - `stories/list.tsx` → `StoryListScreen.tsx`
   - `home/index.tsx` → `home/HomeScreen.tsx` + `home/index.ts`
   - `StoryStage` from `stories/shared.tsx` → its own PascalCase file; the reusable pure helpers stay in a camelCase file
   - `boards/BoardDetail.tsx` → `BoardDetailScreen.tsx`, if the component is `BoardDetailScreen`

   Screen registry IDs do not change. Do **not** rename `app.tsx`.
2. **CQ-74:** every listed cross-area import goes through the target area's barrel:
   - `boards → stories/shared`
   - `stories → stages/shared`
   - `stories → tasks/StoryTasksTab`
   - `stories/list`, `tasks/TaskDetailScreen`, and `board/BoardScreen → stories/pluginFields`

   Shared hooks may move to `src/tui/hooks/` and reusable components to `src/tui/components/` where the responsibility fits: `useEscape`, `useCursor`, `useReloadOnReturn`, `CursorRows`, `StoryStage`. This is optional; barrel re-exports are the minimal fix. Leave `pluginFields.ts` in place (WP05A edits it); only route its imports through the barrel.
3. **CQ-59:** rename `PluginSlot`'s `plugin` prop to `pluginId` and update its call sites (BoardDetail, Story detail, TaskDetail).
4. **CQ-57 (optional):** `PluginScreen` → `PluginScreenHost`. Do it only if it doesn't collide with WP05B's plans. Otherwise defer it to WP05B.
5. Do not change any behavior. Do not touch `pluginFields.ts` internals, form submission, or slot error handling. Those belong to WP05A and WP05B.

## Acceptance criteria

- [ ] Each moved file contains one component, and its filename matches the component.
- [ ] Screen registry IDs, routes, and rendered output are unchanged. All existing TUI tests and snapshots pass without content changes.
- [ ] None of the cross-area imports listed in CQ-74 remain, and there are no barrel import cycles.
- [ ] `test/architecture.test.ts` passes. No stale paths remain in tests or docs. Docs that mention moved files go in the Docs handoff.
- [ ] The diff is reviewable as renames plus import edits. `git diff -M` shows renames.

## Findings

4 rows. Record final statuses in [findings.md](../findings.md#wp05o).

| Finding | Priority | Disposition | Issue | Required outcome |
| --- | --- | --- | --- | --- |
| [CQ-57](../../../reviews/plugin-architecture/code-quality.md#cq-57) | Optional | Optional | src/tui/screens/plugins/PluginScreen.tsx:7 versus PluginsScreen.tsx:8: singular/plural names obscure that the former hosts arbitrary Plugin screens. Optional rename to PluginScr… | Evaluate; implement only if the entry's condition holds, else `deferred: <reason>`. |
| [CQ-59](../../../reviews/plugin-architecture/code-quality.md#cq-59) | P2 | Useful | src/tui/components/PluginSlot.tsx:10: plugin: string is an ID whereas render's Plugin is a context. Rename prop/locals to pluginId; update src/tui/screens/boards/BoardDetail.tsx… | Required. |
| [CQ-73](../../../reviews/plugin-architecture/code-quality.md#cq-73) | P2 | Useful | In-scope screen names violate the supplied TUI organization rule. | Required. |
| [CQ-74](../../../reviews/plugin-architecture/code-quality.md#cq-74) | P2 | Useful | Cross-area imports bypass required barrels. | Required. |
