# Complete finding index

This ledger retains every finding, including corrected, merged, optional, and withdrawn claims. IDs link directly to their detailed evidence and acceptance criteria. These are review entries, not a count of independent fixes: several IDs describe the same change.

Primary owner and execution priority follow the [master plan](README.md). A primary owner coordinates shared files; it does not authorize editing files assigned to another package. Detailed scope/corrections control whether a recommendation is valid. “Optional / bounded” means evaluate the smaller proposal, not automatically implement a framework. Withdrawn and merged entries require no separate implementation.

**Entries:** 306. Review reports are complete; application source is unchanged.

## Owner summary

| Primary owner | Entries |
| --- | ---: |
| [WP01](README.md#wp01) | 22 |
| [WP02](README.md#wp02) | 21 |
| [WP03](README.md#wp03) | 8 |
| [WP04](README.md#wp04) | 60 |
| [WP05](README.md#wp05) | 33 |
| [WP06](README.md#wp06) | 33 |
| [WP07](README.md#wp07) | 29 |
| [WP08](README.md#wp08) | 73 |
| [WP09](README.md#wp09) | 17 |
| [WP10](README.md#wp10) | 10 |

## WP01

| Finding | Execution priority | Disposition | Issue / evidence pointer |
| --- | --- | --- | --- |
| [ARCH-04](general-architecture.md#arch-04) | P1 | Selected contract change | Expected plugin input errors become INTERNAL failures |
| [ARCH-06](general-architecture.md#arch-06) | P0 | Recommended / see scope | Hooks can start independent nested operations |
| [ARCH-23](general-architecture.md#arch-23) | P0 | Recommended / see scope | Reactions receive a live, shallow-readonly Change Set |
| [ARCH-39](general-architecture.md#arch-39) | P0 | Recommended / see scope | Guards get writer methods and can modify the supposedly final Change Set |
| [ARCH-42](general-architecture.md#arch-42) | P1 | Recommended / see scope | Final result refresh is opt-in and incomplete |
| [CQ-08](code-quality.md#cq-08) | P2 | Useful | Repeated error-to-string conversion includes one unsafe variant. |
| [CQ-27](code-quality.md#cq-27) | P0 dependency | Superseded by RES-06 / ARCH-39 | Document the final immutable view contract; do not preserve live-mutability guidance. |
| [CQ-33](code-quality.md#cq-33) | P2 | Useful | Replacement lookup buries the necessary heterogeneous-type boundary. |
| [CQ-34](code-quality.md#cq-34) | P2 | Useful | src/services/plugins/runtime.ts:139: stage: string is used only as replacement, transform, guard. Use private HandlerStage union. Do not change general PluginError.details into … |
| [CQ-35](code-quality.md#cq-35) | P2 | Useful | src/services/plugins/runtime.ts:206, src/services/doctor.ts:545: changes.forPlugin(id) as PluginChangeSet is redundant; method already returns that type. Delete both casts and u… |
| [CQ-36](code-quality.md#cq-36) | None | Withdrawn | src/services/plugins/runtime.ts:68: rebuilding event objects per phase is small and unmeasured. A memoized map adds state and lets a transform's event-object mutation leak into … |
| [CQ-37](code-quality.md#cq-37) | Optional | Optional | src/services/plugins/runtime.ts:141: optional passThrough WeakSet could be named coreErrors, matching its sole caller fromCore at :86. |
| [CQ-38](code-quality.md#cq-38) | See linked finding | Merged | src/services/plugins/runtime.ts:196: rest as R is not merely a TS rest-typing limitation; the promised subtype is false. |
| [CQ-39](code-quality.md#cq-39) | Optional | Optional | src/services/plugins/runtime.ts:44 caches contexts; src/services/plugins/runtime.ts:48 checks active membership before retrieving them. No cache-lifetime bug shown. Optional com… |
| [DX-17](straightforwardness-for-plugin-authors.md#dx-17) | P0 | Recommended / see scope | Hook types expose nested writes and guards expose mutable Change Sets |
| [DX-19](straightforwardness-for-plugin-authors.md#dx-19) | P2 | Useful advanced reference; relocation optional | Replacements are advanced and should be taught as such |
| [DX-39](straightforwardness-for-plugin-authors.md#dx-39) | P1 | Recommended / see scope | Non-hook callbacks lack uniform plugin/stage error attribution |
| [RES-05](resiliency.md#res-05) | P0 | Recommended / see scope | Reentrant handler mutations save independently and overwrite each other |
| [RES-06](resiliency.md#res-06) | P0 | Recommended / see scope | Change Set views expose mutable internal state and source identities |
| [RES-15](resiliency.md#res-15) | P1 | Recommended / see scope | An unresolved reaction prevents completion and blocks later reactions |
| [RES-16](resiliency.md#res-16) | P1 | Recommended / see scope | Command, filter, and option conversion errors omit plugin identity |
| [OBS-02](other-areas.md#obs-02) | P1 | Recommended / see scope | Attribution is incomplete outside protected pipeline hooks |

## WP02

| Finding | Execution priority | Disposition | Issue / evidence pointer |
| --- | --- | --- | --- |
| [ARCH-37](general-architecture.md#arch-37) | P0 | Recommended / see scope | Local State plugin writes are later clobbered by stale in-memory state |
| [ARCH-38](general-architecture.md#arch-38) | P0 | Recommended / see scope | Plugin file scopes ignore pending Board creation and fall back through pending deletions |
| [ARCH-41](general-architecture.md#arch-41) | P0 | Selected recoverable-commit guarantee | One save phase does not mean a filesystem transaction |
| [CQ-40](code-quality.md#cq-40) | P2 | Useful | src/services/plugins/changeSet.ts:243: return \${await scopeFolder(...)}plugins/${id}/${checkName(name)}\ mixes resolution and assembly. Use const recordFolder = await scopeFold… |
| [CQ-41](code-quality.md#cq-41) | Optional | Optional | src/services/plugins/changeSet.ts:238: prune boundary reconstructed via path.slice(0, path.indexOf(...)). This depends on generated path structure; no reachable bad boundary was… |
| [CQ-42](code-quality.md#cq-42) | P2 | Useful | src/services/plugins/changeSet.ts:56 versus src/services/plugins/changeSet.ts:210: public story() matches before/after keys, private current() matches latest key (or before when… |
| [CQ-43](code-quality.md#cq-43) | Optional | Optional | src/services/plugins/changeSet.ts:76/:103: null latest here means deletion earlier in this Change Set; repository misses throw before this line. Add that comment if editing thes… |
| [CQ-44](code-quality.md#cq-44) | Optional | Optional | src/services/plugins/changeSet.ts:43 uses list; src/services/plugins/changeSet.ts:166 uses p for paths. Rename to pendingChanges and dirs if touching the file broadly. |
| [CQ-45](code-quality.md#cq-45) | P2 | Useful | src/services/plugins/changeSet.ts:86/:107: recordStory/deleteBoard are core-only methods absent from the Plugin interface. Add “Core only” to these comments. |
| [RES-01](resiliency.md#res-01) | P0 | Recommended / see scope | A Change Set can commit only part of an operation |
| [RES-02](resiliency.md#res-02) | P0 | Recommended / see scope | Independent operations can both succeed while one is lost |
| [RES-03](resiliency.md#res-03) | P0 | Recommended / see scope | A failed text write destroys the original plugin file |
| [RES-04](resiliency.md#res-04) | P0 | Recommended / see scope | Folder staging failures make Stories inaccessible |
| [RES-07](resiliency.md#res-07) | P0 | Recommended / see scope | Orphan folders donate plugin files to newly created Stories |
| [RES-08](resiliency.md#res-08) | P0 | Recommended / see scope | A file write can recreate the folder of a deleted owner |
| [RES-10](resiliency.md#res-10) | P0 | Recommended / see scope | Already-queued plugin file paths remain under an old Story key |
| [RES-19](resiliency.md#res-19) | P1 | Recommended / see scope | The prefix cache disagrees with externally changed Boards |
| [RES-21](resiliency.md#res-21) | P3 / containment policy | Policy decision; before confinement claims | Valid plugin paths follow symlinks outside their scope |
| [RES-24](resiliency.md#res-24) | P0 | Recommended / see scope | A Board created in the pending Change Set cannot own a plugin file yet |
| [PERF-03](other-areas.md#perf-03) | P2 | Recommended / see scope | Pending Change Set searches have quadratic aggregate cost |
| [PERF-04](other-areas.md#perf-04) | P2 | Recommended / see scope | First updateStory rereads its before-record |

## WP03

| Finding | Execution priority | Disposition | Issue / evidence pointer |
| --- | --- | --- | --- |
| [ARCH-09](general-architecture.md#arch-09) | P1 | Recommended / see scope | Doctor reconstructs a plugin ID lossily from its code |
| [ARCH-21](general-architecture.md#arch-21) | P2 | Recommended / see scope | Custom doctor checks cannot inspect Local State through DoctorData |
| [CQ-70](code-quality.md#cq-70) | P1 | Recommended | Plugin attribution cannot be reconstructed from a finding code. |
| [CQ-71](code-quality.md#cq-71) | See linked finding | Merged |  |
| [DX-29](straightforwardness-for-plugin-authors.md#dx-29) | Optional | Optional / bounded | Doctor checks spell storage paths and need contextual literal types |
| [RES-09](resiliency.md#res-09) | P0 | Recommended / see scope | Doctor's pre-renumber plugin fix edits the keeper instead of the duplicate |
| [RES-17](resiliency.md#res-17) | P1 | Recommended / see scope | Doctor reconstructs the wrong ID for multiword plugins |
| [VER-03](other-areas.md#ver-03) | P3 / conditional | Conditional / decision | Historical top-level Comments are silently discarded on a later write |

## WP04

| Finding | Execution priority | Disposition | Issue / evidence pointer |
| --- | --- | --- | --- |
| [ARCH-01](general-architecture.md#arch-01) | Optional | Optional / bounded | The service-side contract includes CLI and TUI declarations |
| [ARCH-02](general-architecture.md#arch-02) | Optional | Optional / bounded | Plugin operation names have no explicit implementation catalog |
| [ARCH-03](general-architecture.md#arch-03) | P2 | Recommended / see scope | Pre-save hooks cannot identify the operation's returned entity directly |
| [ARCH-05](general-architecture.md#arch-05) | P2 | Recommended / see scope | The plugin capability object exposes other plugins' contexts |
| [ARCH-08](general-architecture.md#arch-08) | P1 | Recommended / see scope | writeBag can overwrite the root's reserved enablement bit |
| [ARCH-10](general-architecture.md#arch-10) | Optional | Optional / bounded | Domain inputs contain plugin transport metadata |
| [ARCH-11](general-architecture.md#arch-11) | P2 | Recommended / see scope | The generic context exposes a command-only editor capability |
| [ARCH-12](general-architecture.md#arch-12) | Optional | Optional / bounded | Plugin JSON files repeat parsing/serialization and use input-validation errors for corrupt files |
| [ARCH-14](general-architecture.md#arch-14) | P1 | Recommended / see scope | Core operation types do not describe all actual runner results |
| [ARCH-17](general-architecture.md#arch-17) | P2 | Recommended / see scope | Replacement key runtime validation is looser than its type |
| [ARCH-19](general-architecture.md#arch-19) | Optional | Optional / bounded | Plugin form field/value declarations duplicate core form declarations |
| [ARCH-20](general-architecture.md#arch-20) | Optional | Optional / bounded | Timestamp conversion is repeated in mutation consumers |
| [ARCH-22](general-architecture.md#arch-22) | None | Withdrawn | CLI and TUI Board resolution have different, appropriate responsibilities |
| [ARCH-31](general-architecture.md#arch-31) | Optional | Optional / bounded | Commander handlers repeatedly pass their trailing Command to cli.run |
| [ARCH-32](general-architecture.md#arch-32) | P2 | Recommended / see scope | Several extension points are fixture-tested rather than built-in-used |
| [ARCH-33](general-architecture.md#arch-33) | Optional | Optional / bounded | Guard's return type redundantly includes undefined |
| [ARCH-36](general-architecture.md#arch-36) | P0 | Recommended / see scope | Invalid bags look absent and can be overwritten by ordinary mutations |
| [CQ-01](code-quality.md#cq-01) | Optional | Optional | Repeated validation plumbing with different semantics. |
| [CQ-09](code-quality.md#cq-09) | Optional | Optional | Repeated removal of the reserved enabled setting. |
| [CQ-12](code-quality.md#cq-12) | Optional | Optional | Missing-record handling has three local copies. |
| [CQ-13](code-quality.md#cq-13) | Optional | Optional | Repeated Board-result projection. |
| [CQ-20](code-quality.md#cq-20) | Optional | Optional | Small comparator/plural duplication. |
| [CQ-02](code-quality.md#cq-02) | Optional | Optional | Repeated discovery of a newly created Story. |
| [CQ-03](code-quality.md#cq-03) | P2 | Useful | Core-command option input cannot use the existing repeatable parser. |
| [CQ-07](code-quality.md#cq-07) | Optional | Optional | Long-text flag setup is repeated, but not identical. |
| [CQ-14](code-quality.md#cq-14) | P2 | Useful | Three wrappers for { plugins }. |
| [CQ-11](code-quality.md#cq-11) | Optional | Optional | First-letter capitalization has three copies. |
| [CQ-17](code-quality.md#cq-17) | Optional | Optional | src/services/plugins/types.ts:215, src/services/types.ts:233: (string & {}) keeps known-name completion while allowing other strings. Add a short inline explanation at both loca… |
| [CQ-18](code-quality.md#cq-18) | P2 | Useful | src/services/plugins/types.ts:394/:400, src/tui/components/Form.tsx:8/:21: both the field-kind union and value union are duplicated. Define PluginFieldKind once in service Plugi… |
| [CQ-21](code-quality.md#cq-21) | Optional | Optional | src/services/plugins/types.ts:131: OperationInput = OperationOptions. Either document the semantic alias or remove it and use OperationOptions at src/services/plugins/runtime.ts… |
| [CQ-22](code-quality.md#cq-22) | P2 | Useful | src/services/plugins/types.ts:158/:159: field: unknown, result: unknown[] despite CustomFieldInput/CustomFieldDef schemas/service contracts. Use field: CustomFieldInput, both re… |
| [CQ-23](code-quality.md#cq-23) | P2 | Useful | src/services/plugins/types.ts:173/:174: Plugin enable/disable result: unknown, though src/services/types.ts:346/:348 specifies { id: string; enabled: boolean }. Use that result … |
| [CQ-24](code-quality.md#cq-24) | P2 | Useful | src/services/plugins/types.ts:202/:206: GuardResult already includes undefined; use GuardResult \/ Promise<GuardResult>. Remove redundant \/ undefined from the verdict annotatio… |
| [CQ-25](code-quality.md#cq-25) | P2 | Useful | src/services/plugins/types.ts:250, src/services/plugins/runtime.ts:191/:193: bag: object admits arrays/classes while persisted bags are Record<string, unknown>; implementation c… |
| [CQ-26](code-quality.md#cq-26) | Optional | Optional | src/services/plugins/types.ts:325, src/services/plugins/types.ts:465/:466: inline option/tab descriptions. Optional PluginOption and PluginTab<P> names can improve reuse, but on… |
| [CQ-72](code-quality.md#cq-72) | P2 | Useful | src/services/types.ts:147, src/services/stories.ts:261: document that a non-undefined filter for an off/unknown Plugin or one lacking filterStories throws UsageError. |
| [CQ-165](code-quality.md#cq-165) | P2 | Recommended | writeBag promises a generic subtype it does not preserve. |
| [CQ-50](code-quality.md#cq-50) | P2 | Useful | src/plugin-api/index.ts:7 does not re-export Command, though commands receive it; src/plugins/comments/commands.ts:54 uses a structural generic to work around the import boundar… |
| [CQ-51](code-quality.md#cq-51) | Optional | Optional | src/plugin-api/tui.ts:28 exports useToast alongside ui.toast/ui.error. No builtin/fixture uses the hook, but that alone is not dead code. Optional remove it if the intended publ… |
| [CQ-52](code-quality.md#cq-52) | None | Withdrawn | src/plugin-api/index.ts:1 and src/plugin-api/tui.ts:1 already explain that these are deliberate API surfaces. Locally unused hooks/types/schemas can be needed by future Built-in… |
| [CQ-53](code-quality.md#cq-53) | P2 | Useful | src/plugin-api/index.ts:97/:98, src/services/plugins/host.ts:144: absent settings schema returns raw settings, while definePlugin defaults to Record<string, unknown>. Add that d… |
| [CQ-54](code-quality.md#cq-54) | Optional | Optional | src/services/index.ts:19/:21 exports ActivePlugin/LoadPluginsOptions. No direct external consumers found, but LoadPluginsOptions describes an exported loader. Either keep for AP… |
| [CQ-69](code-quality.md#cq-69) | Optional | Optional | src/services/stories.ts:352 and src/services/tasks.ts:105: identical checkStage(config, stageId) validation. Optional extract with unchanged signature into src/services/stageVal… |
| [DX-01](straightforwardness-for-plugin-authors.md#dx-01) | Optional | Optional / bounded | Common Story-field glue merits an optional, bounded helper |
| [DX-06](straightforwardness-for-plugin-authors.md#dx-06) | None | Withdrawn | Standalone TUI types require redundant settings arguments; settings inference itself works |
| [DX-07](straightforwardness-for-plugin-authors.md#dx-07) | P1 | External milestone | Input validation is manual and loses useful diagnostics at hook boundaries |
| [DX-08](straightforwardness-for-plugin-authors.md#dx-08) | P2 | Recommended / see scope | New Story lookup is repetitive and has an implicit subject assumption |
| [DX-11](straightforwardness-for-plugin-authors.md#dx-11) | Optional | Optional / bounded | Core-option conversion makes authors manage low-level Commander values |
| [DX-12](straightforwardness-for-plugin-authors.md#dx-12) | P2 | Recommended / see scope | input on stories list actually returns filter criteria |
| [DX-18](straightforwardness-for-plugin-authors.md#dx-18) | P2 | External milestone | Production context exposes the entire service layer without phase guidance |
| [DX-21](straightforwardness-for-plugin-authors.md#dx-21) | P2 | Recommended / see scope | Editor launch is visible in TUI and hook contexts despite being CLI-only |
| [DX-22](straightforwardness-for-plugin-authors.md#dx-22) | Optional | Optional / bounded | Pending-file reads and stored-file reads look similar; JSON convenience is optional |
| [DX-23](straightforwardness-for-plugin-authors.md#dx-23) | Optional | Optional / bounded | Commander actions repeatedly forward the trailing Command into cli.run |
| [DX-30](straightforwardness-for-plugin-authors.md#dx-30) | P2 | Recommended / see scope | An Action's target does not narrow the focus type |
| [DX-33](straightforwardness-for-plugin-authors.md#dx-33) | P2 | Recommended / see scope | A few intentional type/helper exports would reduce deep-import temptation |
| [DX-34](straightforwardness-for-plugin-authors.md#dx-34) | None | Withdrawn | Explicit return undefined in guards is not required (withdrawn) |
| [DX-35](straightforwardness-for-plugin-authors.md#dx-35) | P2 | Recommended / see scope | Omitted settings schema is permissive; strictness should be an explicit author choice |
| [DX-37](straightforwardness-for-plugin-authors.md#dx-37) | P2 | Recommended / see scope | Generic bag writing on root settings can drop activation |
| [VER-02](other-areas.md#ver-02) | Optional | Optional / bounded | Invalid bags can be mistaken for absent data; migration policy is undefined |
| [SEC-03](other-areas.md#sec-03) | P2 | Recommended / see scope | Command-only editor restriction is unenforced at runtime |

## WP05

| Finding | Execution priority | Disposition | Issue / evidence pointer |
| --- | --- | --- | --- |
| [ARCH-07](general-architecture.md#arch-07) | P2 | Recommended / see scope | Plugin screens cannot navigate to core records |
| [ARCH-13](general-architecture.md#arch-13) | P2 | Recommended / see scope | Core Action-key reservations can drift from input handlers |
| [ARCH-25](general-architecture.md#arch-25) | Optional | Optional / bounded | Specs routes have generic or inherited breadcrumb titles |
| [ARCH-26](general-architecture.md#arch-26) | Optional | Optional / bounded | Plugins reload on both deactivation and return, and repeat local confirmations |
| [ARCH-40](general-architecture.md#arch-40) | P1 | Recommended / see scope | Namespacing does not make every declared UI name or option unique |
| [ARCH-43](general-architecture.md#arch-43) | P0 | Recommended / see scope | One TUI edit submission can commit twice and partially succeed |
| [CQ-55](code-quality.md#cq-55) | P2 | Useful | src/tui/loadPlugins.ts:25 nests parentheticals and implies all branches enable background reactions and warn. In fact :33 returns early without doing :35/:37. Rewrite: “With a l… |
| [CQ-56](code-quality.md#cq-56) | See linked finding | Merged | src/tui/loadPlugins.ts:13: [...host.active()] protects iteration when loading marks a Plugin failed. |
| [CQ-57](code-quality.md#cq-57) | Optional | Optional | src/tui/screens/plugins/PluginScreen.tsx:7 versus PluginsScreen.tsx:8: singular/plural names obscure that the former hosts arbitrary Plugin screens. Optional rename to PluginScr… |
| [CQ-58](code-quality.md#cq-58) | P2 | Useful | src/tui/screens/plugins/PluginScreen.tsx:11, :14, :19, :21: repeated String(id)/String(screen) turns absent/malformed params into strings such as undefined or [object Object]. N… |
| [CQ-59](code-quality.md#cq-59) | P2 | Useful | src/tui/components/PluginSlot.tsx:10: plugin: string is an ID whereas render's Plugin is a context. Rename prop/locals to pluginId; update src/tui/screens/boards/BoardDetail.tsx… |
| [CQ-60](code-quality.md#cq-60) | Optional | Optional | src/tui/hooks/plugins.ts:33: default title capitalizes internal screen names (form→Form). Correction: built-ins do not always pass a title; Specs opens a form at src/plugins/spe… |
| [CQ-61](code-quality.md#cq-61) | Optional | Optional | src/tui/screens/stories/pluginFields.ts:26/:84: private collect/gather are generic. Optional rename to collectPluginFields/gatherPluginInput. They do not actually collide with t… |
| [CQ-62](code-quality.md#cq-62) | Optional | Optional | src/tui/screens/plugins/PluginsScreen.tsx:26 toasts the display name; CLI src/commands/plugins.ts:67/:77 uses the ID. This is reasonable UI versus command syntax, not a bug. If … |
| [CQ-73](code-quality.md#cq-73) | P2 | Useful | In-scope screen names violate the supplied TUI organization rule. |
| [CQ-74](code-quality.md#cq-74) | P2 | Useful | Cross-area imports bypass required barrels. |
| [CQ-75](code-quality.md#cq-75) | Optional | Optional | src/tui/screens/stories/detail.tsx:48/:133 and src/tui/screens/tasks/TaskDetailScreen.tsx:47/:133 repeat Plugin-tab indexing/render plumbing. Distinct Story/Task props make a ge… |
| [CQ-76](code-quality.md#cq-76) | Optional | Optional | src/tui/keymap.ts:29: CORE_KEYS = [...'?,/[] 123456789', ...'qaABcdefhHjJkKlLmnNorsTvy'] hides the reservation rationale. Add grouped comments/readable lists if retaining it. De… |
| [CQ-77](code-quality.md#cq-77) | Optional | Optional | src/tui/shell/Shell.tsx:66: Promise.resolve().then(() => action.run(...)).catch(...) deliberately funnels synchronous throws and rejected promises into a toast. Add that explana… |
| [CQ-78](code-quality.md#cq-78) | P2 | Useful | src/tui/app.tsx:69: activate({ ...current.ctx }). Original explanation “so setCurrent sees a new object” is inaccurate: activation already returns a new enclosing object. The co… |
| [CQ-79](code-quality.md#cq-79) | P2 | Useful | src/tui/screens/stories/form.tsx:44/:45: casts (values.assignees as string[] \/ null) ?? [] and optional(values.priority) as Priority \/ null trust a broad form union. Narrow As… |
| [DX-09](straightforwardness-for-plugin-authors.md#dx-09) | P0 | Recommended / see scope | Empty TUI values must mean clear on edit, not “no input” |
| [DX-20](straightforwardness-for-plugin-authors.md#dx-20) | Optional | Optional / bounded | Nullable selects require plugin-defined string sentinels |
| [DX-24](straightforwardness-for-plugin-authors.md#dx-24) | Optional | Optional / bounded | Screen params are untyped and reserve routing/breadcrumb keys |
| [DX-25](straightforwardness-for-plugin-authors.md#dx-25) | Optional | Optional / bounded | Returning from a child screen requires an undocumented reload idiom |
| [DX-26](straightforwardness-for-plugin-authors.md#dx-26) | Optional | Optional / bounded | Async confirmation flows repeat, but are not identical |
| [DX-27](straightforwardness-for-plugin-authors.md#dx-27) | Optional | Optional / bounded | Async load/error presentation is repetitive and sometimes misleading |
| [DX-28](straightforwardness-for-plugin-authors.md#dx-28) | Optional | Optional / bounded | Hints and key handlers must be kept in sync, with correct active state |
| [DX-31](straightforwardness-for-plugin-authors.md#dx-31) | P1 | Recommended / see scope | A failing field provider blocks the core form; skipping it must not send clear input |
| [RES-11](resiliency.md#res-11) | P0 | Recommended / see scope | Invalid bags are overwritten as if they were empty |
| [RES-13](resiliency.md#res-13) | P1 | Recommended / see scope | Screen error handling intentionally rethrows ordinary plugin errors |
| [RES-20](resiliency.md#res-20) | P2 | Recommended / see scope | TUI reload repeats the promised once-per-run load warning |
| [RES-23](resiliency.md#res-23) | P2 | Recommended / see scope | The no-loader TUI path skips reaction mode and load notifications |

## WP06

| Finding | Execution priority | Disposition | Issue / evidence pointer |
| --- | --- | --- | --- |
| [ARCH-16](general-architecture.md#arch-16) | P2 | Recommended / see scope | The option-capable command set has two manually maintained definitions |
| [ARCH-24](general-architecture.md#arch-24) | P1 | Recommended / see scope | Late surface failures are not fully reconciled with load-time claims |
| [ARCH-28](general-architecture.md#arch-28) | Optional | Optional / bounded | Startup constructs core Commander declarations twice and activates plugins for version queries |
| [ARCH-34](general-architecture.md#arch-34) | Optional | Optional / bounded | Core invokes generic plugin definitions in several service modules |
| [ARCH-35](general-architecture.md#arch-35) | Optional | Optional / bounded | Plugin settings have no generic in-app write surface |
| [CQ-15](code-quality.md#cq-15) | Optional | Optional | Plugin rows are converted at CLI call sites. |
| [CQ-10](code-quality.md#cq-10) | Optional | Optional | Unknown-Plugin wording differs across surfaces. |
| [CQ-28](code-quality.md#cq-28) | Optional | Optional | src/services/plugins/host.ts:118 guards loaded state; src/services/plugins/host.ts:121 uses splice(findIndex(...), 1). A -1 would remove the last element, but no invariant-break… |
| [CQ-29](code-quality.md#cq-29) | P2 | Useful | src/services/plugins/host.ts:113 copies statuses; src/services/plugins/host.ts:114 returns the live active array; src/services/plugins/host.ts:115 returns original status object… |
| [CQ-30](code-quality.md#cq-30) | Optional | Optional | src/services/plugins/host.ts:207: keys.indexOf(key) !== keys.lastIndexOf(key) repeats scans. Optional local seen Set during the existing loop. No measured performance problem fo… |
| [CQ-31](code-quality.md#cq-31) | P2 | Useful | src/services/plugins/host.ts:34/:38: entry is called “raw entry” but enabled has already been removed at :85. Clarify “raw settings, without enabled; Board settings merge over t… |
| [CQ-32](code-quality.md#cq-32) | Optional | Optional | src/services/plugins/host.ts:178: FLAG_RE allows one long flag with optional <required>/[optional] value. Add example comment (--epic <id>, --no-epic, --spec [slug]) if useful. |
| [CQ-46](code-quality.md#cq-46) | P2 | Useful | src/services/plugins/service.ts:12 and src/services/plugins/service.ts:50: if (!entry) definition(id) calls for validation/throw. Rename helper requireDefinition, annotate its i… |
| [CQ-47](code-quality.md#cq-47) | None | Withdrawn | src/services/plugins/service.ts:31: validation inside the root-config updater is appropriate; pure functions can throw. Moving it to a separate read adds I/O and can validate st… |
| [CQ-48](code-quality.md#cq-48) | Optional | Optional | src/services/plugins/service.ts:69–:94: Plugin row collection is in the Plugin service module but not on PluginsService. Optional move to src/services/plugins/rows.ts, update sr… |
| [CQ-49](code-quality.md#cq-49) | P2 | Useful | src/services/plugins/service.ts:36: (err as Error).message assumes what a custom schema throws. Replace locally with err instanceof Error ? err.message : String(err) or CQ-08 he… |
| [CQ-63](code-quality.md#cq-63) | Optional | Optional | src/commands/plugins.ts:118: commandPath(at) === path repeats what a successful walk from a root program establishes. Exported attachment could receive a parented command, so un… |
| [CQ-64](code-quality.md#cq-64) | P2 | Useful | src/commands/plugins.ts:159: settings?: Record<string, unknown> weakens PluginsService.get's required settings (src/services/types.ts:344); :166 adds ?? {}. Make it required and… |
| [CQ-65](code-quality.md#cq-65) | Optional | Optional / useful | src/commands/_shared.ts:42: inline attached-options element type. Optional private AttachedPluginOptions interface with existing id, attributes, input members. The original extr… |
| [CQ-66](code-quality.md#cq-66) | Optional | Optional | src/commands/_shared.ts:81: pluginOptions returns operation input options, distinct from CLI declarations. Optional rename pluginInputOptions, updating callers in Story/Task/Boa… |
| [CQ-67](code-quality.md#cq-67) | Optional | Optional | src/commands/boards.ts:73 and src/commands/tasks.ts:76: const plugins = pluginOptions(cmd) leads to plugins.plugins. Rename local to operationOptions, independent of CQ-66. |
| [CQ-68](code-quality.md#cq-68) | Optional | Optional | src/commands/stories.ts:295 and src/commands/tasks.ts:128 duplicate stageBadge; Story :347's labelled is repeated in Task :151. If touching both renderers, extract stageBadge(st… |
| [DX-10](straightforwardness-for-plugin-authors.md#dx-10) | P1 | Recommended / see scope | A lone negated core option supplies input even when the user gives no flag |
| [DX-13](straightforwardness-for-plugin-authors.md#dx-13) | None | Withdrawn | Lazy component loading is useful; export-unwrapping is small boilerplate |
| [DX-32](straightforwardness-for-plugin-authors.md#dx-32) | Optional | Optional / bounded | Reserved names are checked, but authors lack a preflight/reference |
| [DX-36](straightforwardness-for-plugin-authors.md#dx-36) | P2 | Recommended / see scope | Misspelled operation names are accepted and silently never run |
| [RES-14](resiliency.md#res-14) | P1 | Recommended / see scope | Duplicate option declarations pass loading and abort program construction |
| [RES-18](resiliency.md#res-18) | P1 | Recommended / see scope | Three execution boundaries are broader than their catches |
| [RES-22](resiliency.md#res-22) | P1 | Recommended / see scope | A late load failure still blocks later plugins' name claims |
| [RES-25](resiliency.md#res-25) | P1 | Recommended / see scope | Global negated options are not normalized for clash detection |
| [PERF-05](other-areas.md#perf-05) | Optional | Optional / bounded | Disabled definitions still evaluate their non-TUI modules |
| [PERF-06](other-areas.md#perf-06) | P2 | Recommended / see scope | Startup constructs the core command tree twice |
| [OBS-03](other-areas.md#obs-03) | Optional | Optional / bounded | Listing shows raw settings/status, not effective configuration/contributions |

## WP07

| Finding | Execution priority | Disposition | Issue / evidence pointer |
| --- | --- | --- | --- |
| [ARCH-29](general-architecture.md#arch-29) | P2 | Recommended / see scope | Simultaneous test runs share build outputs |
| [CQ-136](code-quality.md#cq-136) | P2 | Useful | Four TUI setup helpers exercise different integration semantics. |
| [CQ-137](code-quality.md#cq-137) | P2 | Useful | Magic navigation counts bind tests to unrelated field order. |
| [CQ-138](code-quality.md#cq-138) | Optional | Optional | Guard-only fixtures at test/plugins/epics.test.ts:115, specs.test.ts:82, pipeline.test.ts:222, doctor.test.ts:52, epicsDoctor.test.ts:34 repeat small definitions. Optional rejec… |
| [CQ-139](code-quality.md#cq-139) | Optional | Optional; original diagnosis withdrawn | Recorder fixtures at test/plugins/pipeline.test.ts:13/:182 and comments.test.ts:77 use Object.fromEntries with structurally compatible common event subsets. Original claim they … |
| [CQ-140](code-quality.md#cq-140) | P2 | Useful | test/plugins/commentsCli.test.ts:15 and commentsTui.test.tsx:31 read/cast raw thread data. Add readCommentThread(t: TempRoot, key: string, taskIndex?: number): Promise<Comment[]… |
| [CQ-141](code-quality.md#cq-141) | P2 | Useful | test/plugins/load.test.ts:54: host.failures()[0] as never suppresses indexed-access uncertainty. Replace with host.failures().map(failureWarning)[0] in the assertion, or explici… |
| [CQ-142](code-quality.md#cq-142) | See linked finding | Merged; see local fallback | test/plugins/tui.test.tsx:39: ctx.plugins as NonNullable<RowblyContext['plugins']>. Keep const host = await load(t) and call loadTuiPlugins(host), assigning host to ctx. |
| [CQ-143](code-quality.md#cq-143) | Optional | Optional | test/plugins/helpers.ts:48, tui.test.tsx:18/:47, epicsTui.test.tsx:34 and load.test.ts:10 rebuild static reserved command/key metadata. Optional const reserved = reservedNames()… |
| [CQ-144](code-quality.md#cq-144) | Optional | Optional | test/plugins/cli.test.ts:6/:9, epicsCli.test.ts:5/:6, specsCli.test.ts:7/:9, commentsCli.test.ts:11: tiny CLI/JSON wrappers repeat. Their executable/cwd options differ. Share on… |
| [CQ-145](code-quality.md#cq-145) | P2 | Useful | test/plugins/cli.test.ts:11 async root only awaits/returns pluginRoot; replace calls directly. :55/:58 dynamically imports fs for ordinary test helpers; import mkdir/readFile on… |
| [CQ-146](code-quality.md#cq-146) | Optional | Optional / useful | test/plugins/pipeline.test.ts:303–:314: late helper declarations are legal, not a control-flow bug. Local pathExists suppresses all I/O errors; replace it with src/storage expor… |
| [CQ-147](code-quality.md#cq-147) | Optional | Optional | test/plugins/specsCli.test.ts:95: one test sits outside the file's describe; :7 uses Parameters<typeof runCli>[1]. Optional move into describe('rowbly specs') and import existin… |
| [CQ-148](code-quality.md#cq-148) | Optional | Optional / useful | test/plugins/specsTui.test.tsx:135 loop-generated tests could use it.each; test/plugins/comments.test.ts:36 combines null/stranger author cases inside one test. Parameterize Com… |
| [CQ-149](code-quality.md#cq-149) | Optional | Optional / useful | test/plugins/specsTui.test.tsx:51/:77/:129 lists characters; Comments spreads a string; Epics passes words. A whole string to app.press produces one input event, unlike characte… |
| [CQ-150](code-quality.md#cq-150) | Optional | Optional | test/plugins/epics.test.ts:41: ctx.now = ... differs from fixedClock().advance in Comments. Optional inject a retained fixedClock in setup and advance it. Mutating the test cloc… |
| [CQ-151](code-quality.md#cq-151) | None | Withdrawn | test/plugins/epicsDoctor.test.ts:1 is separate while specs.test.ts:111 groups Doctor tests. Both are cohesive organizations; no reason to force a merge. |
| [CQ-152](code-quality.md#cq-152) | P2 | Useful | test/plugins/commentsTui.test.tsx:91: pure relativeTime cases live in an integration suite. Move unchanged cases to test/plugins/relativeTime.test.ts importing only the helper. |
| [CQ-153](code-quality.md#cq-153) | P2 | Useful | test/plugins/pipeline.test.ts:157: 10ms sleep after releasing a reaction. Microtask ordering makes a failure unlikely here; prior “cannot flake” language overclaimed. Use an exp… |
| [CQ-154](code-quality.md#cq-154) | P2 | Useful / optional | test/plugins/fixtures/others.ts:86: “like Specs will” is stale now that Specs exists; change to “like Specs”. Exported order state is intentionally reset at pipeline.test.ts:42;… |
| [CQ-155](code-quality.md#cq-155) | P2 | Useful | test/plugins/fixtures/notes.ts:32: if (!parsed.success \/\/ !key) return silently ignores supplied malformed input; docs docs/PLUGINS.md:306 points authors to fixtures. Preserve… |
| [CQ-156](code-quality.md#cq-156) | P2 | Useful | test/plugins/doctor.test.ts:11: join(root, path, '..') works but dirname(join(root, path)) makes parent intent explicit. test/plugins/bags.test.ts:78 casts story.tasks; parse wi… |
| [CQ-157](code-quality.md#cq-157) | Optional | Optional | test/architecture.test.ts:1 enforces layers/imports, not AGENTS.md component naming/barrels. After CQ-73/CQ-74, optionally add a focused cross-area import rule using the test's … |
| [DX-15](straightforwardness-for-plugin-authors.md#dx-15) | P2 | Recommended / see scope | Useful repository test helpers are not a public plugin-author harness |
| [PERF-07](other-areas.md#perf-07) | P2 | Recommended / see scope | No repeatable scalability/read-budget benchmark |
| [TEST-01](other-areas.md#test-01) | Optional | Optional / bounded | Isolation exists, but authors must assemble internal harness wiring |
| [TEST-02](other-areas.md#test-02) | P2 | Recommended / see scope | Repeated TUI setup wires warning delivery differently |
| [TEST-03](other-areas.md#test-03) | Optional | Optional / bounded | Single in-process test runs build both CLI bundles |
| [TEST-04](other-areas.md#test-04) | P2 | Recommended / see scope | No explicit checklist ties each mutation to both surfaces |

## WP08

| Finding | Execution priority | Disposition | Issue / evidence pointer |
| --- | --- | --- | --- |
| [ARCH-18](general-architecture.md#arch-18) | Optional | Optional / bounded | Roster validation of Me is duplicated, but context-lifetime caching would be wrong |
| [ARCH-30](general-architecture.md#arch-30) | P2 | Recommended / see scope | Epic link guards read stored files rather than pending files |
| [CQ-04](code-quality.md#cq-04) | Optional | Optional | Built-in Plugin naming/layout is inconsistent. |
| [CQ-05](code-quality.md#cq-05) | Optional | Optional | Internal operation and function verbs vary. |
| [CQ-06](code-quality.md#cq-06) | Optional | Optional | Delete result shapes vary. |
| [CQ-16](code-quality.md#cq-16) | See linked finding | Merged | Nested ternary inventory. |
| [CQ-19](code-quality.md#cq-19) | P2 | Useful | Bag unlinking uses inconsistent modification timestamps. |
| [CQ-80](code-quality.md#cq-80) | Optional | Optional; original diagnosis withdrawn | src/plugins/epics/index.ts:6/:12 parses EpicInput in transform and guard. Parsing once via caching is unsafe: guards validate the post-transform result/input contract and hooks … |
| [CQ-81](code-quality.md#cq-81) | P2 | Useful | src/plugins/epics/index.ts:48: epicOptions.slice(0, 1) depends on an implicit first-option invariant. Declare linkEpicOption and clearEpicOption and assemble lists by name. |
| [CQ-82](code-quality.md#cq-82) | P2 | Useful | src/plugins/epics/index.ts:57: filter equality accepts unknown; malformed objects return no Stories instead of an invalid-filter error. Add a local/schema EpicFilter = z.union([… |
| [CQ-83](code-quality.md#cq-83) | Optional | Optional | src/plugins/epics/index.ts:29: settings: z.object({}) differs from Specs/Comments' absent schema. Removing it is not behavior-neutral: an empty schema strips unknown settings; a… |
| [CQ-84](code-quality.md#cq-84) | Optional | Optional | src/plugins/epics/index.ts:64: severity: 'warning' as const provides legitimate literal narrowing through flatMap. Optionally annotate its callback (story): PluginFinding[] => .… |
| [CQ-85](code-quality.md#cq-85) | P2 | Useful | src/plugins/epics/model.ts:25: new ValidationError('Invalid Epic data', ...) lacks a field-level summary and labels Story input/patch errors as general Epic data. Include format… |
| [CQ-86](code-quality.md#cq-86) | Optional | Optional | src/plugins/epics/service.ts:13, :35, :40, :52, :60, :82 and src/plugins/epics/index.ts:15/:66/:73 repeat ${id}.json; three writes repeat JSON serialization/newline. Optional pr… |
| [CQ-87](code-quality.md#cq-87) | Optional | Optional | src/plugins/epics/service.ts:50/:58: edit and close/reopen repeat get/patch/stamp/write. writeEpic under CQ-86 may be enough. Only if still useful, private changeEpic(plugin, op… |
| [CQ-88](code-quality.md#cq-88) | Optional | Optional | src/plugins/epics/service.ts:93/:98: mutable done accumulates inside Promise.all. This is not a JS race: each increment after await executes synchronously. Optional return each … |
| [CQ-89](code-quality.md#cq-89) | P2 | Useful | src/plugins/epics/EpicList.tsx:18 calls showEpic per result; src/plugins/epics/service.ts:90 rereads Epic, :91 calls epicStories, whose :70 lists all Stories each time; per-Epic… |
| [CQ-90](code-quality.md#cq-90) | Optional | Optional | src/plugins/epics/service.ts:28 and src/plugins/specs/specs.ts:83: suffix removal uses slice(0, -5)/-3. Optional EPIC_FILE_EXTENSION = '.json' and local SPEC_FILE_EXTENSION = '.… |
| [CQ-91](code-quality.md#cq-91) | None | Withdrawn | src/plugins/epics/service.ts:22: validates ID then compares to the original ID. The schema has no trim/case transform, so the claimed normalized-versus-original mismatch does no… |
| [CQ-92](code-quality.md#cq-92) | P2 | Useful | src/plugins/epics/service.ts:89: exported showEpic infers a substantial nested result. Name EpicProgress = { done: number; total: number; percent: number } and EpicSummary with … |
| [CQ-93](code-quality.md#cq-93) | Optional | Optional | src/plugins/epics/commands.ts:4: DescriptionOptions includes name; rename EpicWriteOptions. Repeated setup at :29/:71 may use local withEpicWriteOptions(cmd: Command): Command a… |
| [CQ-94](code-quality.md#cq-94) | P2 | Useful | src/plugins/epics/commands.ts:77 reads Epic before checking “nothing to update” at :82. Correction: absence of flags does not open an editor. Move a raw presence check for name,… |
| [CQ-95](code-quality.md#cq-95) | Optional | Optional | src/plugins/epics/commands.ts:87: two-command close/reopen registration loop is small/cohesive. Explicit registration is optional for discoverability; a higher-order registratio… |
| [CQ-96](code-quality.md#cq-96) | Optional | Optional | src/plugins/epics/tui.ts:21/:22/:27/:40/:45/:47: No Epic/All Epics encode selection states. Name private NO_EPIC = 'No Epic'/ALL_EPICS = 'All Epics' constants and use in default… |
| [CQ-97](code-quality.md#cq-97) | P2 | Useful | src/plugins/epics/tui.ts:26, :44, :46: nested ternaries convert selection to input/filter/summary. Replace with early returns in the same callbacks, retaining undefined for unch… |
| [CQ-98](code-quality.md#cq-98) | None | Withdrawn | src/plugins/epics/tui.ts:6 and screens' PluginScreenProps<Record<string, unknown>> repeat a legitimate no-settings generic. An EpicSettings alias with no actual settings obscure… |
| [CQ-99](code-quality.md#cq-99) | Optional | Optional | src/plugins/epics/EpicList.tsx:16/:18: async dependency on active reloads both leaving and returning; similarly detail. Comment why the mounted tab refreshes on activation. Shar… |
| [CQ-100](code-quality.md#cq-100) | Optional | Optional | src/plugins/epics/EpicList.tsx:30: ternary cycles open/closed/all. Optional private nextEpicMode(mode: 'open' \/ 'closed' \/ 'all') using a switch. An array/index/cast solution … |
| [CQ-101](code-quality.md#cq-101) | None | Withdrawn | src/plugins/epics/EpicDetail.tsx:46–:59 and src/plugins/specs/SpecDetailScreen.tsx:24–:35: a finally setter after ui.back() is normal cleanup; no warning/leak or behavioral fail… |
| [CQ-102](code-quality.md#cq-102) | None | Withdrawn | src/plugins/epics/EpicForm.tsx:17 and src/plugins/specs/SpecFormScreen.tsx:17/:18: kind: 'text' as const preserves the literal type in an array spread; it is not an unsafe asser… |
| [CQ-103](code-quality.md#cq-103) | P1 | Recommended | The target and result types admit states the implementation cannot support. |
| [CQ-104](code-quality.md#cq-104) | P2 | Useful | Raw Zod errors are inconsistent validation presentation, but the original exit-code claim was false. |
| [CQ-105](code-quality.md#cq-105) | P2 | Useful / optional | src/plugins/specs/index.ts:80 and src/plugins/specs/specs.ts:146 duplicate the incompatible set/add/remove check. CLI checks currently preserve UsageError outside the wrapping b… |
| [CQ-106](code-quality.md#cq-106) | Optional | Optional | src/plugins/specs/index.ts:36/:56/:100 duplicate ${slug}.md from specs.ts:46; Story filename at :44. Optional local boardSpecFile(slug: string): string and STORY_SPEC_FILE = 'sp… |
| [CQ-107](code-quality.md#cq-107) | Optional | Optional; original diagnosis withdrawn | src/plugins/specs/index.ts:33 create guard scans every changed Story, while update at :49 checks the named Story and :52 checks requested/new links. Replacing the create loop wi… |
| [CQ-108](code-quality.md#cq-108) | Optional | Optional | src/plugins/specs/specs.ts:74/:103/:104/:123, commands.ts:46/:49/:65: repeated target.story ?? target.slug. After CQ-103, optionally introduce specTargetName(target: SpecTarget)… |
| [CQ-109](code-quality.md#cq-109) | P2 | Useful | src/plugins/specs/specs.ts:94: opaque final boolean in saveSpec(..., create), callers at commands.ts:62 and SpecFormScreen.tsx:23. Use an explicit mode 'create' \/ 'edit', or pu… |
| [CQ-110](code-quality.md#cq-110) | Optional | Optional; original diagnosis withdrawn | src/plugins/specs/specs.ts:49 takes a narrow resolveBoard callback; this is useful decoupling, not a defect. Original proposal to pass PluginCommandEnv into service is withdrawn… |
| [CQ-111](code-quality.md#cq-111) | P2 | Useful | src/plugins/specs/specs.ts:120: outer let unlinked is mutated inside the operation. Return the local count from the body: const unlinked = await plugin.operation(..., async chan… |
| [CQ-112](code-quality.md#cq-112) | Optional | Optional | src/plugins/specs/specs.ts:40: heading matcher repeated in test/replace; :34 intentionally captures title with a different pattern. Sharing the identical noncapturing regex is o… |
| [CQ-113](code-quality.md#cq-113) | Optional | Optional | src/plugins/specs/specs.ts:98: parent-resolution comment could explain validation order. Original rationale that body NotFoundError is automatically wrapped is false: src/servic… |
| [CQ-115](code-quality.md#cq-115) | P2 | Useful / optional | minor; U/O; C. Long-text glue is repeated, but the original proposed simplification would overwrite an editor's title. |
| [CQ-114](code-quality.md#cq-114) | Optional | Optional | src/plugins/specs/commands.ts:24–:70: four verbs share a branched action loop. Optional explicit show/delete actions and a small shared create/edit setup/read helper; retain coh… |
| [CQ-116](code-quality.md#cq-116) | Optional | Optional | src/plugins/specs/commands.ts:4: Options→SpecOptions; :29/:32/:33: placeholders <KEY>/<t>/<md> could be <key>/<title>/<text>. Uppercase KEY is not inherently wrong because it il… |
| [CQ-117](code-quality.md#cq-117) | P2 | Useful | Initial Board resolution and a user-requested chooser share the same undefined state. |
| [CQ-118](code-quality.md#cq-118) | P1 | Recommended | Failure states are blank or falsely report absence. |
| [CQ-119](code-quality.md#cq-119) | Optional | Optional | src/plugins/specs/SpecDetailScreen.tsx:10 and SpecTab.tsx:8: confirm holds boolean state. Optional rename state/setter confirming/setConfirming, matching Comments. |
| [CQ-120](code-quality.md#cq-120) | None | Withdrawn | src/plugins/specs/SpecTab.tsx:12: const linked = [] is an evolving array whose element type TypeScript infers from pushes at :14; it is not an escaped unchecked any[]. |
| [CQ-121](code-quality.md#cq-121) | Optional | Optional | src/plugins/specs/SpecsScreen.tsx:48, SpecsSection.tsx:10, commands.ts:21: repeated ${s.slug}  ${s.title} within different separators. Optional plugin-local specLine(spec: Board… |
| [CQ-122](code-quality.md#cq-122) | Optional | Optional | src/plugins/specs/SpecText.tsx:25: - 1 reserves the status row at :38; name STATUS_ROWS = 1 or comment it. :30 duplicates normal j/k/arrow delta from public moveDelta; use it if… |
| [CQ-123](code-quality.md#cq-123) | P2 | Useful | src/plugins/specs/tui.ts:26: always emits { specs: [] } even for a new Story with no selection; unlike Epic input this needlessly transforms/guards. After dirty-field preservati… |
| [CQ-166](code-quality.md#cq-166) | P1 | Recommended / useful | minor; P/U; C/I. A stale linked Spec can be selected but invisible in the form. New cross-check finding. |
| [CQ-124](code-quality.md#cq-124) | Optional | Optional | src/plugins/comments/comments.ts:38/:43/:64/:78: repeats commentsOn(plugin, owner.task ?? owner.story) and three owned lookups. Optional private threadOf(plugin: PluginContext, … |
| [CQ-125](code-quality.md#cq-125) | P2 | Useful / optional | src/plugins/comments/comments.ts:111: handwritten blank-body issues; model.ts:6's .min(1) accepts whitespace, while direct mutation rejects whitespace. Form/prompt validation do… |
| [CQ-126](code-quality.md#cq-126) | P2 | Useful | src/plugins/comments/comments.ts:14/:20/:26: Owner, ownerOf, ownerId have only same-module references; model.ts:3 CommentSchema is used only within model. Remove these export mo… |
| [CQ-127](code-quality.md#cq-127) | P2 | Useful | src/plugins/comments/comments.ts:87: updateThread lacks a declared Story result; :94 repeats owner.task?.id despite the preceding guard. Annotate : Story, capture const taskId =… |
| [CQ-128](code-quality.md#cq-128) | Optional | Optional | src/plugins/comments/comments.ts:120: small code-unit comparator ternary is clear. Use CQ-20 helper only if chosen; localeCompare is not an equivalent substitution. |
| [CQ-129](code-quality.md#cq-129) | Optional | Optional | src/plugins/comments/commands.ts:71/:72, CommentsTab.tsx:90/:94/:106: repeats author fallback and edited marker. Optional isCommentEdited(comment: Comment): boolean and commentA… |
| [CQ-130](code-quality.md#cq-130) | P2 | Useful | src/plugins/comments/commands.ts:37: opts.edit ? current.body : undefined repeats the reader's edit-only use of initial text. Pass current.body directly. |
| [CQ-131](code-quality.md#cq-131) | P1 | Recommended | src/plugins/comments/CommentsTab.tsx:76: failure renders red “No Comments.” while true empty state at :82 is separate. Change to “Could not load Comments.” useAsync already toas… |
| [CQ-132](code-quality.md#cq-132) | P2 | Useful | src/plugins/comments/CommentsTab.tsx:103: unconditional c add · e edit · d delete duplicates footer :35–:48 and advertises edit/delete on an empty thread/while confirming. Delet… |
| [CQ-133](code-quality.md#cq-133) | P2 | Useful | src/plugins/comments/CommentsTab.tsx:17: CommentsTabProps has no outside consumer. Remove export; keep component exported. |
| [CQ-134](code-quality.md#cq-134) | P2 | Useful | src/plugins/comments/CommentFormScreen.tsx:7/:8: String(params.target ?? '') and params.id as string \/ undefined turn malformed navigation into bad IDs or wrong mode. Validate … |
| [CQ-135](code-quality.md#cq-135) | Optional | Optional | src/plugins/comments/relativeTime.ts:2/:3: year/month use fixed 365/30 days. Add “Months and years are approximate elapsed-time units.” No calendar library necessary. |
| [CQ-167](code-quality.md#cq-167) | None | Withdrawn | Unsupported draft reference; withdrawn. No source finding or implementation task. |
| [DX-38](straightforwardness-for-plugin-authors.md#dx-38) | P2 | Recommended / see scope | Plugin-owned record updates need an explicit timestamp convention |
| [RES-12](resiliency.md#res-12) | P1 | Recommended / see scope | A corrupt Epic blocks core form/filter loading and is invisible to doctor |
| [PERF-01](other-areas.md#perf-01) | P2 / scale gate | Conditional / decision | TUI Epic list loads all Stories once per Epic |
| [PERF-02](other-areas.md#perf-02) | P2 | Recommended / see scope | Specs doctor reads identical files once per Story link |
| [PERF-08](other-areas.md#perf-08) | P2 | Recommended / see scope | Multi-Spec filtering reparses the bag per candidate slug |
| [PERF-09](other-areas.md#perf-09) | P2 | Recommended / see scope | Slug-only Specs controls load complete documents |
| [UI-01](other-areas.md#ui-01) | P1 | Recommended / see scope | Empty Boards with Specs have no TUI force-delete path |
| [UI-02](other-areas.md#ui-02) | P2 | Recommended / see scope | TUI Comments trim content that CLI preserves |

## WP09

| Finding | Execution priority | Disposition | Issue / evidence pointer |
| --- | --- | --- | --- |
| [ARCH-15](general-architecture.md#arch-15) | P2 | Recommended / see scope | Supporting architecture/contracts documentation still describes removed core Comments |
| [CQ-158](code-quality.md#cq-158) | P2 | Useful | docs/PLUGINS.md:17 says Plugins work through capabilities including “running git”; src/services/plugins/types.ts:241's PluginContext has no such capability and the Git Plugin is… |
| [CQ-159](code-quality.md#cq-159) | P2 | Useful / optional | docs/PLUGINS.md:284 describes cli.parseRepeatable; it works in Plugin command callbacks but is unavailable to core-attached options.input (types.ts:330). Narrow the explanation … |
| [CQ-160](code-quality.md#cq-160) | P2 | Useful | docs/PLUGINS.md:229/:231: created-Story search plus pluginInput as object teaches unchecked bag input. Show a concrete schema, skip undefined, safeParse/validate supplied input,… |
| [CQ-161](code-quality.md#cq-161) | Optional | Optional / useful | docs/PLUGINS.md:284 already says cli.run prints warnings/errors like core; types.ts:295 explicitly discusses exit codes. The original blanket missing-error-description claim is … |
| [CQ-162](code-quality.md#cq-162) | Optional | Optional | docs/PLUGINS.md:172 references CORE_KEYS by source path. Authors reading it is a valid reference strategy. Optional make it a clickable relative link after CQ-76; don't duplicat… |
| [CQ-163](code-quality.md#cq-163) | See linked finding | Merged | docs/PLUGINS.md:153/:169 accurately list current Comments/Epics operations. Update only after the supervisor's chosen verb contract/CQ-05 lands. |
| [CQ-164](code-quality.md#cq-164) | See linked finding | Merged; see local fallback | docs/PLUGINS.md:134/:136: <t>/<md> placeholders are currently accurate. Update with CQ-116 if that cosmetic choice is adopted. |
| [DX-03](straightforwardness-for-plugin-authors.md#dx-03) | P2 | Recommended / see scope | Author instructions begin with architecture rather than a runnable progression |
| [DX-04](straightforwardness-for-plugin-authors.md#dx-04) | P2 | Recommended / see scope | The guide needs precise boundary examples, not wholesale replacement |
| [DX-05](straightforwardness-for-plugin-authors.md#dx-05) | P2 | Recommended / see scope | There is no minimal complete hello world, and built-in integration needs a checklist |
| [DOC-01](other-areas.md#doc-01) | P2 | Recommended / see scope | Current architecture/contracts contradict source |
| [DOC-02](other-areas.md#doc-02) | P2 | Recommended / see scope | Historical ADR language is presented as current implementation status |
| [DOC-03](other-areas.md#doc-03) | P2 | Recommended / see scope | Writing guide lacks a complete executable tutorial/reference |
| [DOC-04](other-areas.md#doc-04) | P2 | Recommended / see scope | Public JSDoc leaves lifecycle/ownership contracts underspecified |
| [DOC-05](other-areas.md#doc-05) | P2 | Recommended / see scope | Glossaries omit supported null/no-target cases and precise heading rule |
| [OBS-01](other-areas.md#obs-01) | P2 | Recommended / see scope | No opt-in successful-operation/hook trace |

## WP10

| Finding | Execution priority | Disposition | Issue / evidence pointer |
| --- | --- | --- | --- |
| [ARCH-27](general-architecture.md#arch-27) | Optional | Optional / bounded | Persisted plugin format evolution needs a stated policy |
| [DX-02](straightforwardness-for-plugin-authors.md#dx-02) | P3 | External milestone | There is no supported external SDK package or installed-plugin loader |
| [DX-14](straightforwardness-for-plugin-authors.md#dx-14) | P3 | External milestone | Independently shipped plugins need an explicit compatibility policy |
| [DX-16](straightforwardness-for-plugin-authors.md#dx-16) | Optional | Optional / bounded | A scaffold is convenient after a stable runnable example exists |
| [BUILD-01](other-areas.md#build-01) | P3 / conditional | External milestone | Public Plugin API is not a distributable package entry |
| [VER-01](other-areas.md#ver-01) | P3 / conditional | External milestone | No explicit Plugin API compatibility/version policy |
| [SEC-01](other-areas.md#sec-01) | P3 / conditional | External milestone | Architectural import restrictions do not confine runtime code |
| [SEC-02](other-areas.md#sec-02) | P3 / conditional | Conditional / decision | Lexical Plugin filenames do not establish physical filesystem containment |
| [GIT-01](other-areas.md#git-01) | P3 / conditional | Conditional / decision | ADR-0016 needs narrowly scoped host capabilities |
| [DEP-01](other-areas.md#dep-01) | P3 / conditional | Conditional / decision | Dependency semantics are not implemented, but current registry can evolve |
