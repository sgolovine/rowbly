# WP05B — TUI containment, activation & navigation

**Depends on:** WP05O, WP01B · **Wave:** 3 · **Priority:** P1 (containment, activation, UI identity), P2/optional for the rest
**Review sources:** [README WP05](../../../reviews/plugin-architecture/README.md#wp05); [RES-13](../../../reviews/plugin-architecture/resiliency.md#res-13), [RES-18](../../../reviews/plugin-architecture/resiliency.md#res-18) (C), [RES-20](../../../reviews/plugin-architecture/resiliency.md#res-20), [RES-23](../../../reviews/plugin-architecture/resiliency.md#res-23); [ARCH-07](../../../reviews/plugin-architecture/general-architecture.md#arch-07), [ARCH-13](../../../reviews/plugin-architecture/general-architecture.md#arch-13), [ARCH-26](../../../reviews/plugin-architecture/general-architecture.md#arch-26), [ARCH-40](../../../reviews/plugin-architecture/general-architecture.md#arch-40); [DX-24–28](../../../reviews/plugin-architecture/straightforwardness-for-plugin-authors.md#dx-24); [CQ-55–62, CQ-75–78](../../../reviews/plugin-architecture/code-quality.md#cq-55).

## Goal

1. A throwing plugin component, Action, or async callback produces a localized, attributed failure. Core navigation and the other plugins keep working.
2. TUI activation behaves the same with and without a loader, and warns once per run.
3. UI identities are stable (Home routes, settings sections, tabs, fields).
4. Plugins get typed reverse navigation to core records and validated screen params.

## Owns

- `src/tui/components/PluginSlot.tsx`
- `src/tui/screens/plugins/**`, including the optional CQ-57 rename if WP05O deferred it
- `src/tui/shell/**` (`ScreenBoundary`, `Shell` Action invocation)
- `src/tui/hooks/**` (`useAsync`, `plugins.ts`, `shell.ts`, the new `useReloadOnReturn.ts`)
- `src/tui/loadPlugins.ts`, `src/tui/app.tsx`, `src/tui/index.ts`, `src/tui/keymap.ts`
- `src/tui/screens/home/**`, `src/tui/screens/settings/sections.ts`
- `src/tui/screens/stories/StoryDetailScreen.tsx` and `src/tui/screens/tasks/TaskDetailScreen.tsx`: the tab and slot plumbing only
- `src/tui/screens/boards/**`: slots only. UI-01's force flow belongs to WP08B, which runs after this package.
- `test/plugins/tui.test.tsx`, `test/tui/useAsync.test.tsx` (new), the render part of `test/plugins/tuiFailureIsolation.test.tsx`, and a new key-reservation test

## Type grant

The `PluginUi` navigation block (`openStory`, `openTask`, `openBoard`), the `PluginScreenProps` params typing, and the route-metadata documentation blocks in `types.ts`.

## Deliverables

1. **Render containment (RES-13).**
   - Add a plugin-local error boundary component in its own file. It wraps **a child component that performs** `render(context, ui)`, so the boundary actually encloses the callback.
   - Apply it to every slot (Story and Task tabs, Board sections, settings sections) and to plugin screens.
   - It catches ordinary render errors and synchronous commit or effect errors. It names the plugin and shows a small "unavailable" fallback.
   - `RowblyError`s keep their hints.
   - It resets only on an explicit retry or a meaningful plugin or route change. Repeated renders must not create a warning loop.
   - Do not globally swallow core programming errors.
2. **Async callback containment (DX-39 TUI part).** Route Actions (`Shell`), field providers, and filter summaries that WP05A left local through WP01B's `invokePlugin` adapter. There must be no double toasts.
3. **RES-18C.** `useAsync` invokes `Promise.resolve().then(fn)` so that synchronous throws become rejections. Keep the cancellation flag. Test a synchronous throw, a rejection, and a stale completion after unmount or a dependency change.
4. **Activation (RES-20, RES-23, CQ-55, CQ-78).**
   - The TUI always sets background-reaction mode and sends failure notifications after loading the host's TUI contributions. Only host replacement depends on a loader being present.
   - Keep a session set of warnings already shown, keyed by Data Root and plugin ID, so a reload doesn't repeat the warning. Plugin status still shows every failure. Choose and document whether a changed reason, or recovery followed by a new failure, warns again.
   - Fix the `loadPlugins` comment (CQ-55).
   - Fix the `app.tsx` copy comment (CQ-78).
   - Once WP06's snapshot `active()` has merged, drop the defensive spread or keep it with a comment (CQ-56).
5. **UI identity (ARCH-40, UI part).**
   - Home routes use stable values (`core:<screen>:<i>`, `plugin:<id>:<i>`).
   - Settings section IDs and tab keys are stable values, not labels.
   - Validate duplicate local field names, settings IDs, tab IDs or labels, and missing linked screens at load. The error is attributed and fails that plugin only.
6. **Key reservations (ARCH-13, CQ-76).** Add a source/AST-based test that collects the single-character literals in core input comparisons, key hints, and helper tables (`boardKey`, movement keys, confirmation keys, reusable components) and asserts that each one is reserved. Make `CORE_KEYS` readable, with grouped comments. Do not build a key dispatcher.
7. **Navigation and params:**
   - ARCH-07 capability: `ui.openStory(key)`, `ui.openTask(id)`, and `ui.openBoard(id)` implemented by the core router adapter, with meaningful titles. Core route names stay private. WP08A adopts this in EpicDetail.
   - DX-24 / CQ-58: document `plugin`, `screen`, and `title` as reserved route metadata. `PluginScreen` narrows its params once, and missing or non-string IDs show an attributed "invalid route" message. No `String(undefined)` lookups. Built-in screens validate their own params in WP08.
8. **Reload on return (ARCH-26, DX-25).** Move `useReloadOnReturn` into `src/tui/hooks/useReloadOnReturn.ts`. It accepts an optional explicit `active` flag. Export it through the hooks barrel and `src/plugin-api/tui.ts`. It reloads once on a false→true transition, never on initial mount or on blur. WP08A, WP08B, and WP08C migrate their consumers.
9. **Optional.** Evaluate each; implement it or defer it with a reason.
   - DX-26 `useAsyncConfirmation`.
   - DX-27 a generic async-state component. Local fixes in WP08 come first.
   - DX-28 a matched hints/keys recipe.
   - CQ-60 title fallback documentation.
   - CQ-62 the name+ID toast.
   - CQ-75 a precise `PluginTabSlot`.
   - CQ-77 a comment.

## Acceptance criteria

- [ ] A real mounted plugin screen, Story and Task tab, Board section, and settings section, each throwing during render and during a synchronous effect, shows a localized fallback. Escape and core navigation work. Healthy plugin content still renders. Expected Rowbly errors keep their hints, and ordinary errors name the plugin (RES-13).
- [ ] Event-handler and async failures (Action, field, summary) are attributed without crashing the TUI (DX-39 TUI part).
- [ ] `useAsync` handles synchronous throws (RES-18C).
- [ ] The injected-host, no-loader startup uses background reactions, reports import and settings failures, and keeps healthy slots, the same as the loader path. Repeated reloads of one failure push one toast. A different root's failure still warns (RES-20, RES-23).
- [ ] Two Home entries with the same label navigate to their distinct destinations. Duplicate own field names and missing linked screens fail clearly at load (ARCH-40).
- [ ] Adding a new core key without reserving it fails the reservation test (ARCH-13).
- [ ] `ui.openStory` opens core Story detail, and Back returns to the plugin screen. Plugin source imports no router (ARCH-07 capability).
- [ ] `useReloadOnReturn` reloads once on return and never on mount or blur (ARCH-26, DX-25).
- [ ] Disabled or reloaded plugins leave no stale Actions, fields, or context.
- [ ] Every new React component has its own PascalCase file and is exported through its area barrel.

## Findings

21 rows. Record final statuses in [findings.md](../findings.md#wp05b).

| Finding | Priority | Disposition | Issue | Required outcome |
| --- | --- | --- | --- | --- |
| [ARCH-13](../../../reviews/plugin-architecture/general-architecture.md#arch-13) | P2 | Recommended / see scope | Core Action-key reservations can drift from input handlers | Required. |
| [ARCH-26](../../../reviews/plugin-architecture/general-architecture.md#arch-26) | Optional | Optional / bounded | Plugins reload on both deactivation and return, and repeat local confirmations | Evaluate; implement only if the entry's condition holds, else `deferred: <reason>`. |
| [ARCH-40](../../../reviews/plugin-architecture/general-architecture.md#arch-40) | P1 | Recommended / see scope | Namespacing does not make every declared UI name or option unique | Required. |
| [CQ-55](../../../reviews/plugin-architecture/code-quality.md#cq-55) | P2 | Useful | src/tui/loadPlugins.ts:25 nests parentheticals and implies all branches enable background reactions and warn. In fact :33 returns early without doing :35/:37. Rewrite: “With a l… | Required. |
| [CQ-56](../../../reviews/plugin-architecture/code-quality.md#cq-56) | See linked finding | Merged | src/tui/loadPlugins.ts:13: [...host.active()] protects iteration when loading marks a Plugin failed. | None separately — resolved by CQ-29. |
| [CQ-58](../../../reviews/plugin-architecture/code-quality.md#cq-58) | P2 | Useful | src/tui/screens/plugins/PluginScreen.tsx:11, :14, :19, :21: repeated String(id)/String(screen) turns absent/malformed params into strings such as undefined or [object Object]. N… | Required. |
| [CQ-60](../../../reviews/plugin-architecture/code-quality.md#cq-60) | Optional | Optional | src/tui/hooks/plugins.ts:33: default title capitalizes internal screen names (form→Form). Correction: built-ins do not always pass a title; Specs opens a form at src/plugins/spe… | Evaluate; implement only if the entry's condition holds, else `deferred: <reason>`. |
| [CQ-62](../../../reviews/plugin-architecture/code-quality.md#cq-62) | Optional | Optional | src/tui/screens/plugins/PluginsScreen.tsx:26 toasts the display name; CLI src/commands/plugins.ts:67/:77 uses the ID. This is reasonable UI versus command syntax, not a bug. If … | Evaluate; implement only if the entry's condition holds, else `deferred: <reason>`. |
| [CQ-75](../../../reviews/plugin-architecture/code-quality.md#cq-75) | Optional | Optional | src/tui/screens/stories/detail.tsx:48/:133 and src/tui/screens/tasks/TaskDetailScreen.tsx:47/:133 repeat Plugin-tab indexing/render plumbing. Distinct Story/Task props make a ge… | Evaluate; implement only if the entry's condition holds, else `deferred: <reason>`. |
| [CQ-76](../../../reviews/plugin-architecture/code-quality.md#cq-76) | Optional | Optional | src/tui/keymap.ts:29: CORE_KEYS = [...'?,/[] 123456789', ...'qaABcdefhHjJkKlLmnNorsTvy'] hides the reservation rationale. Add grouped comments/readable lists if retaining it. De… | Evaluate; implement only if the entry's condition holds, else `deferred: <reason>`. |
| [CQ-77](../../../reviews/plugin-architecture/code-quality.md#cq-77) | Optional | Optional | src/tui/shell/Shell.tsx:66: Promise.resolve().then(() => action.run(...)).catch(...) deliberately funnels synchronous throws and rejected promises into a toast. Add that explana… | Evaluate; implement only if the entry's condition holds, else `deferred: <reason>`. |
| [CQ-78](../../../reviews/plugin-architecture/code-quality.md#cq-78) | P2 | Useful | src/tui/app.tsx:69: activate({ ...current.ctx }). Original explanation “so setCurrent sees a new object” is inaccurate: activation already returns a new enclosing object. The co… | Required. |
| [DX-24](../../../reviews/plugin-architecture/straightforwardness-for-plugin-authors.md#dx-24) | Optional | Optional / bounded | Screen params are untyped and reserve routing/breadcrumb keys | Evaluate; implement only if the entry's condition holds, else `deferred: <reason>`. |
| [DX-25](../../../reviews/plugin-architecture/straightforwardness-for-plugin-authors.md#dx-25) | Optional | Optional / bounded | Returning from a child screen requires an undocumented reload idiom | Evaluate; implement only if the entry's condition holds, else `deferred: <reason>`. |
| [DX-26](../../../reviews/plugin-architecture/straightforwardness-for-plugin-authors.md#dx-26) | Optional | Optional / bounded | Async confirmation flows repeat, but are not identical | Evaluate; implement only if the entry's condition holds, else `deferred: <reason>`. |
| [DX-27](../../../reviews/plugin-architecture/straightforwardness-for-plugin-authors.md#dx-27) | Optional | Optional / bounded | Async load/error presentation is repetitive and sometimes misleading | Evaluate; implement only if the entry's condition holds, else `deferred: <reason>`. |
| [DX-28](../../../reviews/plugin-architecture/straightforwardness-for-plugin-authors.md#dx-28) | Optional | Optional / bounded | Hints and key handlers must be kept in sync, with correct active state | Evaluate; implement only if the entry's condition holds, else `deferred: <reason>`. |
| [RES-13](../../../reviews/plugin-architecture/resiliency.md#res-13) | P1 | Recommended / see scope | Screen error handling intentionally rethrows ordinary plugin errors | Required. |
| [RES-18C](../../../reviews/plugin-architecture/resiliency.md#res-18) | P1 | Recommended / see scope | Synchronous useAsync callbacks throw before the rejection handler exists: invoke via Promise.resolve().then(fn) | Required. |
| [RES-20](../../../reviews/plugin-architecture/resiliency.md#res-20) | P2 | Recommended / see scope | TUI reload repeats the promised once-per-run load warning | Required. |
| [RES-23](../../../reviews/plugin-architecture/resiliency.md#res-23) | P2 | Recommended / see scope | The no-loader TUI path skips reaction mode and load notifications | Required. |

ARCH-07 is closed by WP08A when EpicDetail adopts the capability. ARCH-25 is closed by WP08B. Both depend on the capabilities and documentation delivered here.
