# WP06 — Host loading & CLI registration

**Depends on:** WP04A · **Wave:** 2 · **Priority:** P1 (P2 and optional items included)
**Review sources:** [README WP06](../../../reviews/plugin-architecture/README.md#wp06); [RES-14](../../../reviews/plugin-architecture/resiliency.md#res-14), [RES-18](../../../reviews/plugin-architecture/resiliency.md#res-18), [RES-22](../../../reviews/plugin-architecture/resiliency.md#res-22), [RES-25](../../../reviews/plugin-architecture/resiliency.md#res-25); [ARCH-16](../../../reviews/plugin-architecture/general-architecture.md#arch-16), [ARCH-17](../../../reviews/plugin-architecture/general-architecture.md#arch-17), [ARCH-24](../../../reviews/plugin-architecture/general-architecture.md#arch-24), [ARCH-40](../../../reviews/plugin-architecture/general-architecture.md#arch-40); [DX-10](../../../reviews/plugin-architecture/straightforwardness-for-plugin-authors.md#dx-10), [DX-36](../../../reviews/plugin-architecture/straightforwardness-for-plugin-authors.md#dx-36).

## Goal

Make plugin activation and CLI registration deterministic and atomic per plugin:

- validate definitions up front, including duplicate IDs, flags, Commander attributes, actions, and hook names;
- stage each plugin's complete CLI contribution and publish it in one step;
- a failed plugin leaves no command, option, input adapter, or name claim behind, and does not block healthy plugins;
- host status APIs return snapshots.

Also tidy the startup and CLI findings.

## Owns

- `src/services/plugins/host.ts`, `src/services/plugins/service.ts`
- `src/main.ts`, `src/cli.ts`
- `src/plugins/index.ts`: RES-18A, only if the lazy-descriptor option is chosen
- `src/commands/**`. This includes `plugins.ts`, `_shared.ts`, `stories.ts`, `tasks.ts`, `boards.ts`, and `assignees.ts`, for registration, option-input gathering, and the CQ-63–68 edits.
- `src/output/**`: CQ-68, optional
- `test/plugins/load.test.ts`, `test/plugins/cli.test.ts`, and new tests: `test/plugins/registrationFailure.test.ts`, `test/plugins/moduleFailure.test.ts`, and a CLI wiring test for ARCH-16

## May touch

`src/tui/loadPlugins.ts`, but only to keep TUI import failures consistent with the claim policy (RES-22, W10). Coordinate with WP05B, which owns that file's activation and notification behavior. If WP05B is already running, post a CCR.

## Deliverables

1. **Definition validation before activation:**
   - **RES-14, ARCH-40 (CLI part), CQ-30:**
     - Detect duplicate raw long flags within one plugin.
     - Detect duplicate Commander attribute names (`--foo-1-bar` and `--foo1-bar` are duplicates).
     - Reject malformed kebab flags such as `--foo--bar` and `--foo-bar-`.
     - Allow the intentional pair `--x` / `--no-x`.
     - Compute attribute names with Commander's own rules, inside attributed validation.
   - **RES-25:** normalize global option base names with the same `no-` rule. A plugin declaring either polarity of a reserved global name fails.
   - **ARCH-17 and DX-36:** replacement keys and hook keys in core namespaces are checked against `CORE_OPERATION_NAMES`, which WP04A publishes. Unknown core-namespace names fail with a near-name hint (`stories.edit → stories.update`, `delete → remove`). Custom `<plugin>.<op>` names stay allowed and are documented as untyped.
   - **ARCH-16:** keep one authoritative readonly list of option-capable commands and derive the union type from it. Unsupported paths fail at load.
   - **DX-32:** a `validatePluginDefinition(definition, reserved)` function, backed by the same validator, that returns structured diagnostics. WP07B exposes it through the harness.
2. **Staged registration (ARCH-24, RES-22, W10).**
   - Build command groups and options on detached structures. Publish a plugin's complete registration only after it is fully valid.
   - A missing core attachment path is a contract error attributed to the plugin. It is not silently skipped.
   - Name claims are reconciled within one activation sequence, so that a plugin which fails late does not keep claims that block later plugins.
   - Whether a plugin rejected *before* a late failure gets retried follows the W10 policy. Document it and test it.
   - A failed plugin leaves nothing attached.
3. **DX-10: negation without user input.**
   - Use Commander's option-value source so that a lone `--no-x` that the user didn't supply produces no payload.
   - Pick one rule for passing both `--x` and `--no-x`, last-wins or reject, and document it.
   - Do not add a global `false → null` mapping.
4. **Host snapshots (CQ-29, CQ-56 via WP05B):** `active()`, `failures()`, and status return copies. Status distinguishes activation failure, TUI failure, and unavailable definitions.
5. **RES-18A, static module evaluation.** At minimum, add CLI build and startup smoke tests covering every built-in. Lazy `{ id, name, description, load }` descriptors (PERF-05) are optional. Adopt them only if justified, and then test that `disable` and `status` still work after a load failure. Do not claim the host catches static import failures if you don't adopt them.
6. **Startup (PERF-06, ARCH-28):** derive reserved names from the core program that is actually built, rather than building it twice. An exact `--version`/`-V` fast path may skip activation; don't base it on `argv[0]` alone. Help and init keep their current behavior.
7. **Diagnostics (OBS-03, optional):** `plugins show <id> --board <id>` showing the raw root settings, the Board overrides, and the effective validated settings, with honest labels for unknown, failed, and disabled plugins. Never load inactive TUI. Don't leak secrets.
8. **Small items:** CQ-10 wording (optional), CQ-15 (optional), CQ-28 (optional guard), CQ-31 and CQ-32 comments, CQ-46 `requireDefinition`, CQ-48 (optional), CQ-49 safe message, CQ-63 comment, CQ-64 required settings, CQ-65 / CQ-66 / CQ-67 renames (all optional: `AttachedPluginOptions`, `pluginInputOptions`, `operationOptions`; coordinate with WP04B's CQ-14), CQ-47 (withdrawn: keep validation inside the root-config updater), CQ-68 (optional), DX-13 (document the lazy forms; the shorthand is optional), ARCH-34 (no task: keep the generic dispatch).

## Acceptance criteria

- [ ] Duplicate options inside one plugin fail only that plugin at load. Core commands still construct and run, and nothing from the failed plugin remains: no command, option, or input adapter (RES-14).
- [ ] A valid positive/negative flag pair works. Repeated positive flags, same-attribute spellings, and `--foo--bar` / `--foo-bar-` fail only their own plugin, before registration (ARCH-40).
- [ ] When an earlier plugin's `commands()` throws, a later plugin that declares the same option loads (RES-22). The documented W10 policy is tested.
- [ ] A plugin declaring `--prompt` or `--no-prompt` on any command fails, and the global `--no-prompt` stays authoritative (RES-25).
- [ ] An invalid or plugin-local replacement key, and a misspelled core hook, fail with a specific reason and a suggestion. `notes.add` still works (ARCH-17, DX-36).
- [ ] The option-command list and its type cannot diverge. Board, Task, and Assignee option-only edits reach the right operation (ARCH-16).
- [ ] No flag yields no plugin payload. `--no-x` is distinguishable. Unfiltered lists never become filtered by an implicit `x:true` (DX-10).
- [ ] Mutating the arrays or objects returned by the host cannot change host state (CQ-29).
- [ ] `plugins disable` remains a viable recovery path after a load failure. A cache or reload of a context cannot return settings from a previous activation.
- [ ] CLI startup smoke tests cover all built-ins. `--version` behaves the same with globals placed before or after it.

## Findings

33 rows. Record final statuses in [findings.md](../findings.md#wp06).

| Finding | Priority | Disposition | Issue | Required outcome |
| --- | --- | --- | --- | --- |
| [ARCH-16](../../../reviews/plugin-architecture/general-architecture.md#arch-16) | P2 | Recommended / see scope | The option-capable command set has two manually maintained definitions | Required. |
| [ARCH-17](../../../reviews/plugin-architecture/general-architecture.md#arch-17) | P2 | Recommended / see scope | Replacement key runtime validation is looser than its type | Required. |
| [ARCH-24](../../../reviews/plugin-architecture/general-architecture.md#arch-24) | P1 | Recommended / see scope | Late surface failures are not fully reconciled with load-time claims | Required. |
| [ARCH-28](../../../reviews/plugin-architecture/general-architecture.md#arch-28) | Optional | Optional / bounded | Startup constructs core Commander declarations twice and activates plugins for version queries | Evaluate; implement only if the entry's condition holds, else `deferred: <reason>`. |
| [ARCH-34](../../../reviews/plugin-architecture/general-architecture.md#arch-34) | Optional | Optional / bounded | Core invokes generic plugin definitions in several service modules | Evaluate; implement only if the entry's condition holds, else `deferred: <reason>`. |
| [CQ-10](../../../reviews/plugin-architecture/code-quality.md#cq-10) | Optional | Optional | Unknown-Plugin wording differs across surfaces. | Evaluate; implement only if the entry's condition holds, else `deferred: <reason>`. |
| [CQ-15](../../../reviews/plugin-architecture/code-quality.md#cq-15) | Optional | Optional | Plugin rows are converted at CLI call sites. | Evaluate; implement only if the entry's condition holds, else `deferred: <reason>`. |
| [CQ-28](../../../reviews/plugin-architecture/code-quality.md#cq-28) | Optional | Optional | src/services/plugins/host.ts:118 guards loaded state; src/services/plugins/host.ts:121 uses splice(findIndex(...), 1). A -1 would remove the last element, but no invariant-break… | Evaluate; implement only if the entry's condition holds, else `deferred: <reason>`. |
| [CQ-29](../../../reviews/plugin-architecture/code-quality.md#cq-29) | P2 | Useful | src/services/plugins/host.ts:113 copies statuses; src/services/plugins/host.ts:114 returns the live active array; src/services/plugins/host.ts:115 returns original status object… | Required. |
| [CQ-30](../../../reviews/plugin-architecture/code-quality.md#cq-30) | Optional | Optional | src/services/plugins/host.ts:207: keys.indexOf(key) !== keys.lastIndexOf(key) repeats scans. Optional local seen Set during the existing loop. No measured performance problem fo… | Evaluate; implement only if the entry's condition holds, else `deferred: <reason>`. |
| [CQ-31](../../../reviews/plugin-architecture/code-quality.md#cq-31) | P2 | Useful | src/services/plugins/host.ts:34/:38: entry is called “raw entry” but enabled has already been removed at :85. Clarify “raw settings, without enabled; Board settings merge over t… | Required. |
| [CQ-32](../../../reviews/plugin-architecture/code-quality.md#cq-32) | Optional | Optional | src/services/plugins/host.ts:178: FLAG_RE allows one long flag with optional <required>/[optional] value. Add example comment (--epic <id>, --no-epic, --spec [slug]) if useful. | Evaluate; implement only if the entry's condition holds, else `deferred: <reason>`. |
| [CQ-46](../../../reviews/plugin-architecture/code-quality.md#cq-46) | P2 | Useful | src/services/plugins/service.ts:12 and src/services/plugins/service.ts:50: if (!entry) definition(id) calls for validation/throw. Rename helper requireDefinition, annotate its i… | Required. |
| [CQ-47](../../../reviews/plugin-architecture/code-quality.md#cq-47) | None | Withdrawn | src/services/plugins/service.ts:31: validation inside the root-config updater is appropriate; pure functions can throw. Moving it to a separate read adds I/O and can validate st… | None — withdrawn by the review. Do not implement the original prescription; any residual note in the package is optional. |
| [CQ-48](../../../reviews/plugin-architecture/code-quality.md#cq-48) | Optional | Optional | src/services/plugins/service.ts:69–:94: Plugin row collection is in the Plugin service module but not on PluginsService. Optional move to src/services/plugins/rows.ts, update sr… | Evaluate; implement only if the entry's condition holds, else `deferred: <reason>`. |
| [CQ-49](../../../reviews/plugin-architecture/code-quality.md#cq-49) | P2 | Useful | src/services/plugins/service.ts:36: (err as Error).message assumes what a custom schema throws. Replace locally with err instanceof Error ? err.message : String(err) or CQ-08 he… | Required. |
| [CQ-63](../../../reviews/plugin-architecture/code-quality.md#cq-63) | Optional | Optional | src/commands/plugins.ts:118: commandPath(at) === path repeats what a successful walk from a root program establishes. Exported attachment could receive a parented command, so un… | Evaluate; implement only if the entry's condition holds, else `deferred: <reason>`. |
| [CQ-64](../../../reviews/plugin-architecture/code-quality.md#cq-64) | P2 | Useful | src/commands/plugins.ts:159: settings?: Record<string, unknown> weakens PluginsService.get's required settings (src/services/types.ts:344); :166 adds ?? {}. Make it required and… | Required. |
| [CQ-65](../../../reviews/plugin-architecture/code-quality.md#cq-65) | Optional | Optional / useful | src/commands/_shared.ts:42: inline attached-options element type. Optional private AttachedPluginOptions interface with existing id, attributes, input members. The original extr… | Evaluate; implement only if the entry's condition holds, else `deferred: <reason>`. |
| [CQ-66](../../../reviews/plugin-architecture/code-quality.md#cq-66) | Optional | Optional | src/commands/_shared.ts:81: pluginOptions returns operation input options, distinct from CLI declarations. Optional rename pluginInputOptions, updating callers in Story/Task/Boa… | Evaluate; implement only if the entry's condition holds, else `deferred: <reason>`. |
| [CQ-67](../../../reviews/plugin-architecture/code-quality.md#cq-67) | Optional | Optional | src/commands/boards.ts:73 and src/commands/tasks.ts:76: const plugins = pluginOptions(cmd) leads to plugins.plugins. Rename local to operationOptions, independent of CQ-66. | Evaluate; implement only if the entry's condition holds, else `deferred: <reason>`. |
| [CQ-68](../../../reviews/plugin-architecture/code-quality.md#cq-68) | Optional | Optional | src/commands/stories.ts:295 and src/commands/tasks.ts:128 duplicate stageBadge; Story :347's labelled is repeated in Task :151. If touching both renderers, extract stageBadge(st… | Evaluate; implement only if the entry's condition holds, else `deferred: <reason>`. |
| [DX-10](../../../reviews/plugin-architecture/straightforwardness-for-plugin-authors.md#dx-10) | P1 | Recommended / see scope | A lone negated core option supplies input even when the user gives no flag | Required. |
| [DX-13](../../../reviews/plugin-architecture/straightforwardness-for-plugin-authors.md#dx-13) | None | Withdrawn | Lazy component loading is useful; export-unwrapping is small boilerplate | None — withdrawn by the review. Do not implement the original prescription; any residual note in the package is optional. |
| [DX-32](../../../reviews/plugin-architecture/straightforwardness-for-plugin-authors.md#dx-32) | Optional | Optional / bounded | Reserved names are checked, but authors lack a preflight/reference | Evaluate; implement only if the entry's condition holds, else `deferred: <reason>`. |
| [DX-36](../../../reviews/plugin-architecture/straightforwardness-for-plugin-authors.md#dx-36) | P2 | Recommended / see scope | Misspelled operation names are accepted and silently never run | Required. |
| [OBS-03](../../../reviews/plugin-architecture/other-areas.md#obs-03) | Optional | Optional / bounded | Listing shows raw settings/status, not effective configuration/contributions | Evaluate; implement only if the entry's condition holds, else `deferred: <reason>`. |
| [PERF-05](../../../reviews/plugin-architecture/other-areas.md#perf-05) | Optional | Optional / bounded | Disabled definitions still evaluate their non-TUI modules | Evaluate; implement only if the entry's condition holds, else `deferred: <reason>`. |
| [PERF-06](../../../reviews/plugin-architecture/other-areas.md#perf-06) | P2 | Recommended / see scope | Startup constructs the core command tree twice | Required. |
| [RES-14](../../../reviews/plugin-architecture/resiliency.md#res-14) | P1 | Recommended / see scope | Duplicate option declarations pass loading and abort program construction | Required. |
| [RES-18A](../../../reviews/plugin-architecture/resiliency.md#res-18) | P1 | Recommended / see scope | Static plugin module evaluation happens before host startup: add CLI build/startup smoke tests for all built-ins; lazy descriptors only if containment is required | Required. |
| [RES-22](../../../reviews/plugin-architecture/resiliency.md#res-22) | P1 | Recommended / see scope | A late load failure still blocks later plugins' name claims | Required. |
| [RES-25](../../../reviews/plugin-architecture/resiliency.md#res-25) | P1 | Recommended / see scope | Global negated options are not normalized for clash detection | Required. |

ARCH-40's UI-identity portion is closed by WP05B. This package implements its CLI-flag portion; note in the PR which acceptance items you covered.
