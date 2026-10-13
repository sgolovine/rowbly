# General architecture: plugin framework review

Reviewed 2026-10-13 against source at `5b3acd475968ad5577bdb0a2008f7f46be3639de`, using GPT 6.1 Sol with xhigh reasoning. This supersedes the earlier report in thread `mcp:6bdca54c-af26-45a4-9ca3-b501c1031a27`. All 35 earlier finding IDs are retained; ARCH-36 onward are additional findings. Source files were not modified.

The architecture's basic abstractions fit the three built-in plugins. The most urgent work is to make its existing contracts true: preserve bags through later operations, avoid treating invalid data as absent during writes, resolve file scopes against pending records, separate guards from writers, and make operation results and errors consistent. The supervisor has also selected coordinated, recoverable filesystem commits as a release requirement based on the combined resilience evidence. A larger plugin platform, dependency graph, permission system, generic migration engine, or new package layout is not necessary for this release.

## Evidence and priority conventions

- **Confirmed** means directly established by current source, existing test assertions, or an explicitly described source-level probe. It does not mean a newly added regression test passed.
- **Inferred** identifies a future consequence, architectural tradeoff, or conditional failure that was not executed. Such a consequence is marked separately from the confirmed code fact.
- **Release blocker** means fix the identified correctness defect or settle the public contract before release. **Useful improvement** can be scheduled independently. **Optional abstraction** is not a release requirement; a concrete smaller alternative is given where appropriate.
- Severity uses critical / major / minor / nit. No finding is classified critical: the evidence supports specific data-loss and contract defects, not a general claim that all operations are unsafe.
- Paths and line numbers refer to the reviewed source. New tests listed below are acceptance criteria for implementers and were not run in this review.

The previous review reported three `pnpm test` runs: the first had 23 failures across seven files, and the next two passed 66 files / 610 tests. The handoff includes a completed passing output. The cause of the first failures was **not established**. Shared output directories make concurrent rebuilds a plausible explanation (ARCH-29), not a demonstrated diagnosis. Per the current supervisor instruction, this pass ran no `pnpm test`, typecheck, or lint. Six focused probes used `node --import tsx` against current source and disposable `/tmp` Data Roots; an additional read-only Commander probe checked option attributes. Their scripts and outputs are retained below. They did not rebuild `dist/` or `.test-dist/`. Separately, the supervisor reports passing typecheck, lint, and 66 files / 610 tests in `docs/reviews/plugin-architecture/README.md:35`; those are its checks, not checks run by this reviewer.

## Execution ownership

The supervisor's [README.md](README.md) was read for conflict checking and was not edited. Its priorities and decisions take precedence over alternatives retained here. The labels below describe responsibility within a finding; the work-package owners control edits. In particular, **WP04 owns `types.ts`; WP01 owns runtime execution; WP02 owns Change Set storage**. A finding naming several owners requires one coordinated contract, not competing edits. This report does not authorize source edits or create additional agents.

| Owner | Primary files | Coordination boundary |
| --- | --- | --- |
| Pipeline | WP01 runtime; WP02 `changeSet.ts` and storage; WP04 `types.ts` and `plugin-api/index.ts` | WP04 publishes signatures; WP01/WP02 implement their portions; consumer changes follow. |
| Loader / CLI | WP06 `host.ts`, CLI attachment and `main.ts`; WP04 shared input parsing | Coordinate shared types with WP04; do not concurrently rewrite host/attachment. |
| Doctor | WP03 `src/services/doctor.ts`, doctor tests | Coordinate transaction/read contracts with WP02/WP04 and built-in checks with WP08. |
| TUI | WP05 hooks, shell, screens, plugin TUI adapter and tests | Coordinate plugin-specific screens with WP08 and form contracts with WP04. |
| Core services | WP04 public input/result changes; WP02 Local State synchronization | ARCH-14/37/42/43 need an explicitly assigned core-service editor under these packages. |
| Plugin consumers | WP08 `src/plugins/{epics,specs,comments}` | Each plugin has one owner; framework changes provide follow-up consumer tasks. |
| Documentation / validation | WP09 docs/ADRs; WP07 test-build infrastructure; WP04 compile fixtures | Update contracts after decisions; supervisor runs combined checks once. |

New finding mapping for the consolidated index: ARCH-36 → WP04/WP05/WP08; ARCH-37/38/41 → WP02, with WP01/WP04 integration; ARCH-39 → WP01/WP04; ARCH-40 → WP05/WP06; ARCH-42 → WP04 plus core-service consumers; ARCH-43 → WP04/WP05, with core-service ownership agreed before editing. ARCH-41's earlier documented-limits-only alternative is superseded by README decision 2. ARCH-27's formal external compatibility policy belongs to WP10/P3; built-in invalid-data preservation is already required under ARCH-36.

## Findings

### <a id="arch-01"></a>ARCH-01 — The service-side contract includes CLI and TUI declarations

**Severity:** minor. **Priority:** useful improvement; a full layer split is optional. **Status:** confirmed coupling; no confirmed runtime UI dependency.

**Evidence:** `src/services/plugins/types.ts:2` and `src/services/plugins/types.ts:3` import Commander and React with `import type`; `src/services/plugins/types.ts:303`, `src/services/plugins/types.ts:365`, and `src/services/plugins/types.ts:481` hold command paths, UI slots, and the combined definition. `src/services/plugins/host.ts:7` / `src/services/plugins/host.ts:185` validate CLI and key claims. `test/plugins/helpers.ts:3` imports `reservedNames` from the program builder. `test/architecture.test.ts:101` excludes package specifiers from its downward-layer check. The layer table is `docs/ARCHITECTURE.md:109`.

**Problem and correction:** the contract's ownership spans services and surfaces, and service test setup depends on the program builder. The previous report called this a broken runtime layering boundary. That overstates it: these UI imports are erased, and the documented check intentionally covers relative modules. Moving every type is not a prerequisite for correctness.

**Recommended change:** document the distinction between declarative type dependencies and runtime dependencies. Add an architecture rule rejecting runtime `react`, `ink`, and `commander` imports under services, while allowing the existing type-only declarations. Use a small explicit reserved-name fixture in pipeline-only tests; keep tests of actual core clashes using `reservedNames()`. If a later type split is chosen, first define a services-facing `CorePlugin` containing hooks, settings, bags, filters, rows, and doctor, and compose surface declarations above it. Do not waive all type-import architecture checks or introduce a new host layer solely to relocate this file.

**Acceptance:** current type-only imports pass; an injected runtime UI import in services fails the architecture check; service pipeline tests no longer need the program solely for neutral reservations. **Dependencies / conflicts:** coordinates with ARCH-16 and ARCH-19 if types move. Owner: Documentation / validation, with Pipeline. A broad host move conflicts with almost every loader/pipeline task and should be a separate, optional change.

### <a id="arch-02"></a>ARCH-02 — Plugin operation names have no explicit implementation catalog

**Severity:** minor. **Priority:** useful contract improvement; mandatory schema registration is optional. **Status:** confirmed absence; future naming difficulty is inferred.

**Evidence:** `src/services/plugins/runtime.ts:205` blindly prefixes the caller's string; `src/services/plugins/types.ts:255` accepts any name; `src/services/plugins/types.ts:213` permits string hook keys. Epics uses `create`, `edit`, `close`, `reopen`, `delete` at `src/plugins/epics/service.ts:34`, `:50`, `:58`, `:74`; Specs uses `create|edit|delete` at `src/plugins/specs/specs.ts:101` / `:121`; Comments uses `add|update|remove` at `src/plugins/comments/comments.ts:47`, `:60`, `:76`. Comments' naming is deliberately retained in `docs/adr/0018-comments-are-a-built-in-plugin.md:5`.

**Problem and correction:** string names are the cross-plugin integration contract; a typo is silently a different operation. Mixed CRUD verbs alone are not a correctness bug—core also uses `assignees.add`. The earlier recommendation to mandate `create|update|remove` and rename `comments.add` overrides an explicit ADR without a demonstrated need.

**Recommended change:** publish an operation table covering every built-in name, input shape, and result. Add consumer tests that record the names and inputs emitted by each built-in mutation. Validate a local operation name as a nonempty single segment; reject dots or malformed names so callers cannot accidentally produce `epics.epics.delete`. Keep the current published verbs unless the supervisor explicitly chooses a uniform convention. An `operations` catalog on the definition can later make typos detectable, but do not require a schema/dispatcher redesign merely for this inventory.

**Acceptance:** all built-in mutations match the table; malformed local names fail before save; CLI verbs remain independent from service-operation names. **Dependencies / conflicts:** ARCH-14 establishes truthful results; ARCH-04 establishes input-error handling. No circular dependency on new schemas is required. Owner: Pipeline plus Plugin consumers; Documentation owns the single naming decision. Do not let separate plugin agents rename verbs independently.

### <a id="arch-03"></a>ARCH-03 — Pre-save hooks cannot identify the operation's returned entity directly

**Severity:** minor. **Priority:** useful improvement. **Status:** confirmed API omission; ambiguity under a replacement is inferred.

**Evidence:** `src/services/plugins/runtime.ts:68` constructs events without a result; the result exists at `src/services/plugins/runtime.ts:94`, before transforms. Only reactions have `result` (`src/services/plugins/types.ts:196`). Epics (`src/plugins/epics/index.ts:35`), Specs (`src/plugins/specs/index.ts:27`), and Notes (`test/plugins/fixtures/notes.ts:45`) find the first Story change with `before === null`.

**Problem and correction:** the same lookup is repeated. Appending a second Story in a transform does **not** by itself select the wrong one: changes retain insertion order and core creates its Story first. A replacement that creates several records in another order can make the lookup ambiguous. The previous report presented that conditional risk as an existing built-in failure.

**Recommended change:** separate `ReplacementEvent<I,S>` (no result, with `core()`) from `PreSaveEvent<I,R,S>` (with `result`). Add the body/replacement result to transform and guard events, documenting that it identifies the operation's returned entity before transforms. Reactions retain the final result semantics addressed in ARCH-42. Update Story-create hooks to use `result.key`, then `changes.updateStory`. No additional `created()` / `updated()` query DSL is needed.

**Acceptance:** a replacement puts two Stories into the Change Set and returns the second; Epic/Specs input applies to that returned Story. Replacement code has no fictitious preexisting `result`. **Dependencies / conflicts:** coordinate with ARCH-14, ARCH-39, and ARCH-42 for a single event-type edit. Owner: Pipeline; follow-up consumer edits by each plugin owner.

### <a id="arch-04"></a>ARCH-04 — Expected plugin input errors become INTERNAL failures

**Severity:** major. **Priority:** release blocker (error contract decision). **Status:** confirmed source behavior; historical CLI reproduction is retained separately.

**Evidence:** `src/services/plugins/runtime.ts:145` wraps expected Rowbly errors as `PluginError` unless they originated from replacement `core()`; `src/services/plugins/runtime.ts:106` maps every guard verdict to `ConflictError`. Epics validates user input in its transform (`src/plugins/epics/index.ts:8`, `src/plugins/epics/model.ts:25`). Specs calls raw `SpecsInput.parse` at `src/plugins/specs/specs.ts:145`. Expected exit codes are `src/core/errors.ts:45` / `:51` / `:57` / `:63`. The current policy is explicitly documented at `docs/PLUGINS.md:75` and `:244`.

**Problem:** an invalid `--epic Auth` is a plugin INTERNAL error with a suggestion to disable Epics, although it is a user validation failure. A missing requested Epic is CONFLICT rather than NOT_FOUND. This matches the current ADR, so changing it requires a deliberate contract amendment, not merely repairing code to match docs. The earlier CLI probe observed exit 1 for `Auth` and exit 4 for missing `auth`; this pass verified the responsible source rather than trusting `dist/` freshness.

**Recommended change:** preserve expected `UsageError`, `ValidationError`, `NotFoundError`, and `ConflictError` from handlers, retaining their hints and issues while adding authoritative `details.plugin`, `operation`, and `stage`. Preserve data-integrity errors too if ARCH-12's helper is adopted. Wrap unexpected throws as INTERNAL with the disable hint. Let a guard throw these expected errors for typed rejections; keep `{reject,hint}` as the convenient CONFLICT form. This avoids inventing a second partial error-code enum. Convert Specs input parsing to a checked `ValidationError` with issues. Amend ADR-0012 via a clearly recorded follow-up and update PLUGINS.md.

**Acceptance:** malformed Epic input exits 2 / VALIDATION; missing requested links exit 3 / NOT_FOUND; refused deletion remains 4 / CONFLICT; unexpected fixture throws remain 1 / INTERNAL; none saves or reacts. JSON diagnostics retain plugin attribution and issues. Test service calls and CLI, and TUI handling of expected validation errors. **Dependencies / conflicts:** independent of ARCH-02's optional catalog. Coordinate with ARCH-09 and ARCH-36 on errors. Owner: Pipeline; consumer-specific expected errors by Plugin consumers; CLI and docs follow.

### <a id="arch-05"></a>ARCH-05 — The plugin capability object exposes other plugins' contexts

**Severity:** major. **Priority:** release blocker (capability contract). **Status:** confirmed reachability; no built-in misuse or adversarial exploit claimed.

**Evidence:** `src/services/plugins/types.ts:253` and `:276` expose full `Services`; `src/services/plugins/runtime.ts:202` returns it unchanged; `src/commands/plugins.ts:128` does the same in command environments. `src/services/types.ts:350` exposes `plugins.context(id)`; `src/services/types.ts:353` includes setup, doctor, and enable/disable services. Context lookup has no caller ownership check (`src/services/plugins/runtime.ts:47`).

**Problem:** a plugin can obtain another active plugin's context, call its `writeBag`, and run operations writing that plugin's files. This contradicts the useful ownership boundary implied by own-ID bag and file helpers. Built-ins are trusted and third-party code is out of scope; this is an API encapsulation problem, not a claim that the current architecture is a security sandbox.

**Recommended change:** define a `PluginServices` projection without `plugins` and `setup`. Preserve the existing ordinary core domain services for commands/screens if that remains the intended capability; handlers get a read-only projection under ARCH-06/39. Doctor access should be read-only if retained; none of the current built-ins needs `doctor.fix`. Construct the projection at runtime, and use it for both `PluginContext.services` and `PluginCommandEnv.services`; changing only the TypeScript alias leaves the capability reachable. Export the projection through Plugin API. Remove the full `Services` re-export from the public plugin-facing contract unless compatibility needs are explicitly documented.

**Acceptance:** plugins cannot access `services.plugins.context`, setup, or doctor mutations through either context or CLI env; existing built-ins still compile and work; core application code retains full Services. **Dependencies / conflicts:** ARCH-06 restricts writes by execution phase, ARCH-39 separates guard capabilities. Owner: Pipeline plus Loader / CLI. No permission manifest or third-party sandbox is requested.

### <a id="arch-06"></a>ARCH-06 — Hooks can start independent nested operations

**Severity:** major. **Priority:** release blocker (one-operation guarantee). **Status:** confirmed missing enforcement; inner-save/outer-rejection consequence inferred from control flow.

**Evidence:** `src/services/plugins/runtime.ts:60` creates a fresh Change Set on every `run`; `src/services/plugins/runtime.ts:114` saves each separately; `src/services/plugins/runtime.ts:205` allows a hook to call `plugin.operation` again. The only prohibition is documentation (`docs/PLUGINS.md:217`). Doctor fixes call plugin callbacks at `src/services/doctor.ts:612` without entering a runner hook phase.

**Problem:** a transform can await a core mutation or plugin operation which saves immediately, then the outer guard can reject. The docs' promise that nothing is saved on rejection no longer holds. A nested write can also be overwritten by the outer snapshot. No current built-in does this.

**Recommended change:** use a runner-owned asynchronous execution scope recording plugin ID, operation, and phase. Reject operation entry originating from transform, guard, replacement, plugin doctor fix, or reaction callbacks. Include plugin operation bodies in the prohibition on starting a second operation. Replacements may call their provided `core()` into the current Change Set. A read-only handler context helps, but retained command contexts can still be captured, so runtime enforcement is necessary. An async-local phase scope is preferable to one shared boolean: unrelated TUI actions can overlap while a background reaction awaits. Wrap doctor fixes through the same phase helper. Reactions must not mutate Rowbly data; the previous report incorrectly proposed allowing them to start core mutations.

**Acceptance:** nested core writes and nested plugin operations fail before the inner save, including through a captured context; outer disk state stays unchanged. Replacement `core()` still works. An unrelated user operation can proceed while a delayed reaction is pending. Doctor callbacks cannot bypass this rule. **Dependencies / conflicts:** ARCH-05, ARCH-39 share context signatures; Doctor owns its callback integration. Owner: Pipeline; no speculative `changes.run()` composition engine or reserved future signature.

### <a id="arch-07"></a>ARCH-07 — Plugin screens cannot navigate to core records

**Severity:** minor. **Priority:** useful improvement backed by an existing consumer. **Status:** confirmed missing capability.

**Evidence:** `src/services/plugins/types.ts:376` only supports opening own screens; `src/tui/hooks/plugins.ts:38` implements only that operation. Epic Stories are plain text at `src/plugins/epics/EpicDetail.tsx:84`; Specs Board sections are plain text at `src/plugins/specs/SpecsSection.tsx:5`.

**Recommended change:** add `ui.openStory(key)`, `ui.openTask(id)`, and `ui.openBoard(id)` implemented by the core router adapter, keeping core route names private. Board navigation should target `board-detail` with `{boardId:id}`; use `story` / `{key}` and `task` / `{id}` for the other routes, with meaningful titles. Make EpicDetail's Stories selectable and open a Story using this capability. No arbitrary core-route escape hatch is needed.

**Acceptance:** selecting an Epic Story opens its core detail; Back returns to the Epic; plugin source imports no router or core screen registry. **Dependencies / conflicts:** no dependency on ARCH-01's optional move. Coordinate with ARCH-25 route metadata and ARCH-26 reload behavior. Owner: TUI with Epics consumer owner.

### <a id="arch-08"></a>ARCH-08 — `writeBag` can overwrite the root's reserved enablement bit

**Severity:** major for root writes. **Priority:** release blocker (bag/settings write contract). **Status:** confirmed helper behavior; no current built-in root write.

**Evidence:** `src/services/plugins/runtime.ts:191` replaces the entire own-ID bag. `RowblyConfig` structurally satisfies `Bagged`; its entry reserves `enabled` (`src/schemas/config.ts:25`). Board bags are already explicitly described as settings (`src/schemas/config.ts:53`), and root entries as settings plus enablement (`docs/PLUGINS.md:34`). `PluginBagSchemas` intentionally excludes Board and root (`src/services/plugins/types.ts:472`).

**Problem and correction:** `plugin.writeBag(rootConfig,{setting:1})` drops `enabled`. There is not an undocumented need for a second Board/root data namespace: the current settings convention is already stated. The earlier report overstated that documentation gap, and its `Story | Task | Assignee | LocalState` restriction is not a reliable exclusion: LocalState is structurally broad and records share fields.

**Recommended change:** explicitly exclude root settings/enablement updates from the generic data-bag writer contract and enforce the exclusion at runtime for full root records (`version` and `assignees` shape). Keep Board settings writes allowed only if clearly documented. Root settings changes use `changes.updateRootConfig` with an explicit merge preserving `enabled`; enablement uses the plugin service. If a settings setter is added later, make it own-ID scoped and preserve enablement. Add a negative compile-time test if the types can express exclusion, but do not rely on a union alone.

**Acceptance:** generic root `writeBag` attempts fail before save; updating own root settings explicitly preserves `enabled` and other plugin entries; Story/Task/Assignee/LocalState helpers retain current behavior. **Dependencies / conflicts:** ARCH-35 defines the first-release editing policy; ARCH-05 does not prevent direct Change Set root updates. Owner: Pipeline, with settings/docs owner. No new persisted namespace required.

### <a id="arch-09"></a>ARCH-09 — Doctor reconstructs a plugin ID lossily from its code

**Severity:** minor. **Priority:** release blocker for diagnostic correctness. **Status:** confirmed.

**Evidence:** `src/services/doctor.ts:534` converts `my-plugin` into `MY_PLUGIN_`; `src/services/doctor.ts:538` drops attribution/details on plugin findings; `src/services/doctor.ts:632` reconstructs only `my` on a fix failure. `PluginFinding` has no details field (`src/services/plugins/types.ts:348`). Core plugin findings already carry `details.plugin` (`src/services/doctor.ts:499`).

**Recommended change:** carry the actual ID in the fix closure/internal finding, and emit `details:{...finding.details,plugin:id}` with framework attribution taking precedence. Add optional structured `details` to `PluginFinding`. Stop parsing IDs out of codes. Validate local codes as uppercase underscore-separated tokens and handle collisions with core codes explicitly. Do not automatically reserve the broad ID `plugin`: checking a resulting code against the core-code set or including explicit attribution is a narrower decision.

**Acceptance:** a throwing fix from `my-plugin` names `my-plugin` in details and its disable hint; successful findings preserve custom details; a plugin attempting a core diagnostic code collision fails clearly rather than masquerading as core. **Dependencies / conflicts:** ARCH-06 doctor phase wrapper, ARCH-21 DoctorData, ARCH-27 migration diagnostics. Owner: Doctor, with Pipeline type agreement. These edits share doctor loops and should be one owner.

### <a id="arch-10"></a>ARCH-10 — Domain inputs contain plugin transport metadata

**Severity:** nit. **Priority:** optional cleanup. **Status:** confirmed repetition; no demonstrated loss in the current strips.

**Evidence:** `src/services/types.ts:53` adds `plugins` to service inputs; explicit strips occur at `src/services/assignees.ts:30`, `src/services/stages.ts:33`, `src/services/fields.ts:33`, and `src/services/setup.ts:74`. Events intentionally include both input and own pluginInput (`src/services/plugins/runtime.ts:70`).

**Problem and correction:** there is repeated transport/domain separation. It is the chosen public envelope, not inherently wrong. The previous recommendation to strip in the runner and delete the service strips would not work: `run` bodies receive only changes and close over original `input` / `patch`; setup does not use the runner at all.

**Recommended change:** keep the current service signatures and event shape for release. A small `withoutPluginInput` pure helper may replace repeated destructuring if it improves readability. A future clean body-input API would require changing `body(changes, coreInput)` and every closure; do that only with an intentional API migration, not a partial runner edit.

**Acceptance:** plugin payloads still reach hooks and never become persisted data bags implicitly; setup's Board input remains explicitly sanitized. No new test suite is needed solely for this cleanup; keep existing bag/pipeline coverage. **Dependencies / conflicts:** do not mix with ARCH-03/14 shared signature fixes. Owner: Core services. Optional; no user-facing bug demonstrated.

### <a id="arch-11"></a>ARCH-11 — The generic context exposes a command-only editor capability

**Severity:** minor. **Priority:** useful API narrowing. **Status:** confirmed availability; editor-over-Ink failure inferred.

**Evidence:** `src/services/plugins/types.ts:260` says command mode only but `src/services/plugins/runtime.ts:207` exposes it to all screens/hooks. Specs uses it at `src/plugins/specs/commands.ts:56`; command env already offers initial editor text (`src/commands/_shared.ts:181`, `:190`).

**Recommended change:** remove `PluginContext.editText` and keep editor access in `PluginCommandEnv.readText`. For Specs, preserve its current title semantics: for edit mode seed `readText({edit:true},{name:'text',initial:titledText(initial,title)})`; for text/file input read it and then apply `titledText`. Do not lose title application by treating all modes identically. Retain the mutually exclusive text/file/edit check, with wording matching Specs' actual `--file` flag.

**Acceptance:** Specs editor input starts with the correct heading; supplied title affects text/file paths; multiple input modes still fail; no screen/hook context exposes editor execution. **Dependencies / conflicts:** ARCH-05 context projection and Specs CLI ownership. Owner: Pipeline plus Specs consumer. Do not add a TUI editor runner.

### <a id="arch-12"></a>ARCH-12 — Plugin JSON files repeat parsing/serialization and use input-validation errors for corrupt files

**Severity:** minor. **Priority:** useful consistency fix; generic JSON methods are optional.

**Status:** confirmed. **Evidence:** `src/plugins/epics/service.ts:11` (manual parse, invalid JSON becomes ValidationError), `:21` (schema validation), and `:40`, `:52`, `:60` (serialization). Core distinguishes stored corruption at `src/storage/jsonStore.ts:14` and validates/formats writes at `:48`. Plugin files expose text-only methods (`src/services/plugins/types.ts:233`, `:121`).

**Recommended change:** at minimum, put Epics' read/write formatting in a private `epicFile.ts` helper and report malformed stored JSON/schema/id mismatch as DATA_INTEGRITY with the relative path. Export `DataIntegrityError` through Plugin API. A public `files.readJson(scope,name,schema)` and `changes.writeJson(scope,name,schema,value)` is justified only if another consumer needs it; if implemented, validate the serialized value, preserve two spaces/newline/schema order, and reuse pending `changes.readFile`. The Epic filename/ID match remains the plugin's responsibility.

**Acceptance:** corrupt Epic files give exit 6 with path information, valid writes preserve format, missing records give NOT_FOUND, and pending JSON reads see earlier pending writes. **Dependencies / conflicts:** ARCH-04 must preserve expected errors from hooks; ARCH-38 handles scope semantics. Owner: Epics consumer first, Pipeline only for accepted common methods.

### <a id="arch-13"></a>ARCH-13 — Core Action-key reservations can drift from input handlers

**Severity:** minor. **Priority:** useful preventive validation. **Status:** confirmed manually maintained table; no current missing core character demonstrated.

**Evidence:** `src/tui/keymap.ts:29` holds the character string; `src/services/plugins/host.ts:204` checks it; `src/tui/shell/Shell.tsx:123` runs a plugin Action before global handling. Screen handlers use separate Ink subscriptions (e.g. `src/tui/screens/stories/detail.tsx:66`).

**Problem and correction:** the prior source search found current core characters represented. The risk is drift when a new core key is added. Returning from Shell's subscription does not cancel another screen's subscription. Runtime arbitration based solely on `useKeyHints` is not a complete key dispatcher, since hints contain composites and some handlers are unadvertised.

**Recommended change:** keep load-time reservation. Add a source/AST-based test collecting single-character literals in core input comparisons and key hints, plus explicit helper tables (`boardKey`, movement keys, confirmation keys), and assert they are reserved. Include reusable components, not just screens/shell. Do not introduce a key dispatcher or dynamic suppression merely for this check.

**Acceptance:** adding a new core character without reserving it fails the check; existing Actions still appear for their targets; core and earlier-plugin collisions remain rejected. **Dependencies / conflicts:** ARCH-40 declaration checks; TUI owner must coordinate any new core key with Loader / CLI. Optional runtime arbitration is a separate feature.

### <a id="arch-14"></a>ARCH-14 — Core operation types do not describe all actual runner results

**Severity:** major. **Priority:** release blocker (hook contract). **Status:** confirmed, including a source-level probe.

**Evidence:** `src/services/plugins/types.ts:158` / `:159` declare field results as `unknown[]`, while `src/services/fields.ts:34` returns `{next,stripped}` to the runner and only unwraps it at `:45`. The probe reaction observed `{"next":[...],"stripped":0}` while the service caller received an array. `boards.remove` is typed as returning undefined (`src/services/plugins/types.ts:147`), but its runner body returns null or LocalState (`src/services/boards.ts:63`, `:75`). `context.clearUse` can expose a LocalState result before the service discards it (`src/services/context.ts:45`). Enable/disable result types are needlessly unknown (`src/services/plugins/types.ts:173`), despite concrete results (`src/services/plugins/service.ts:43`, `:54`).

**Recommended change:** make hook results match the documented public operation results, not accidental service-local bookkeeping. Keep stripped counts and context refresh data outside the returned field/Board deletion result, or map them before reactions. Use `CustomFieldInput` / `CustomFieldDef[]` and `{id:string;enabled:boolean}` where they are known. Add a core-specific `OperationRunner.run<K extends CoreOperationName>` overload checking input and body/final result; plugin string operations use a deliberately separate generic entry. This catches future mismatches instead of relying on casts.

**Acceptance:** reactions to all listed operations receive the declared shape; field update receives the array, Board deletion and clearUse receive undefined; compile-time contract tests reject a wrong core body result. **Dependencies / conflicts:** ARCH-03 and ARCH-42 define when/finalization semantics; ARCH-37 synchronizes context without smuggling it through return values. Owner: Pipeline plus Core services. This replaces the earlier report's nit-only unknown-type cleanup.

### <a id="arch-15"></a>ARCH-15 — Supporting architecture/contracts documentation still describes removed core Comments

**Severity:** minor. **Priority:** useful improvement; public contract drift should be fixed before release. **Status:** confirmed.

**Evidence:** `docs/spec/contracts.md:87` describes Comment bags; `:93` and `:102` retain core comment arrays; `:186` lists Comments with core commands without its enablement caveat; `:194` says Plugins can add options to Comments commands, which is unsupported; `:271` retains a Comments service. `docs/ARCHITECTURE.md:26` / `:28` require IDs absent from current embedded schemas, `:66` describes SQLite, and `:100` omits ADR-0018. `src/services/types.ts:1` says the contract is frozen, without explaining the plugin amendments.

**Recommended change:** remove the core Comment type/service/arrays; move the Comments command description to a built-in-plugin subsection and state enablement. Match option-capable commands to ARCH-16. Replace obsolete issue/SQLite/foreign-key language with current file/Story/embedded Task terminology, and link ADR-0018. Explain how approved plugin ADRs amended the frozen contract rather than casually deleting that governance sentence. PLUGINS.md already states the system is built (`:5`) and explicitly excludes purge (`:11`); no new purge command is needed.

**Acceptance:** docs' stored shapes, service names, option surface, and current glossary agree with source and ADR-0018; no core Comments or SQLite implementation is implied. **Dependencies / conflicts:** do the final API-table pass after ARCH-03/04/05/14/39/42 decisions. Owner: Documentation / validation; avoid competing ADR rewrites by implementation agents.

### <a id="arch-16"></a>ARCH-16 — The option-capable command set has two manually maintained definitions

**Severity:** minor. **Priority:** useful improvement. **Status:** confirmed duplication and coverage gap; unsupported commands are not inherently missing features.

**Evidence:** `src/services/plugins/types.ts:304` defines a union; `src/commands/plugins.ts:18` defines a subset-capable `readonly PluginOptionCommand[]`. Every current listed command forwards plugin input (e.g. `src/commands/boards.ts:45`, `src/commands/tasks.ts:45`, `src/commands/assignees.ts:46`). The fixture CLI checks focus on Stories (`test/plugins/cli.test.ts:93`); pipeline input tests cover only four operations (`test/plugins/pipeline.test.ts:182`).

**Recommended change:** make one authoritative readonly literal list and derive the union, with ownership consistent with the current type boundary (or the optional ARCH-01 refactor). Add table-driven wiring tests for Board, Task, and Assignee commands; ensure option-only edit is accepted. Document that stages, fields, context, and doctor are hookable but do not currently accept added CLI flags. Do not widen that surface without a consumer.

**Acceptance:** list/type cannot diverge; each supported command's fixture flag reaches the correct operation; unsupported paths fail load; Board/Task/Assignee option-only edits work. **Dependencies / conflicts:** ARCH-24 missing-path handling, ARCH-32 duplicates this coverage concern and should not produce a second test task. Owner: Loader / CLI, with Pipeline type coordination.

### <a id="arch-17"></a>ARCH-17 — Replacement key runtime validation is looser than its type

**Severity:** nit. **Priority:** useful small validation. **Status:** confirmed.

**Evidence:** `ReplacementMap` allows only core names (`src/services/plugins/types.ts:221`), but host claims any keys (`src/services/plugins/host.ts:212`) and runtime looks up arbitrary operation names (`src/services/plugins/runtime.ts:77`).

**Recommended change:** keep the current core-only replacement contract and validate definition keys against an authoritative core operation-name list derived alongside the type. The ADR says only operations rather than screens/commands can be replaced; it does not independently establish core-only scope, so document that narrower current TypeScript decision explicitly. Do not silently support replacing another plugin's operation based on a cast.

**Acceptance:** an invalid or plugin-local replacement key fails load with a specific reason; all current core replacements work; double replacement still fails the later plugin. **Dependencies / conflicts:** ARCH-02 operation inventory, ARCH-14 authoritative typed names. Owner: Loader / CLI with Pipeline.

### <a id="arch-18"></a>ARCH-18 — Roster validation of Me is duplicated, but context-lifetime caching would be wrong

**Severity:** nit. **Priority:** optional abstraction. **Status:** confirmed duplication; current behavior is valid.

**Evidence:** Story creator validation is `src/services/stories.ts:63`; Comments author validation is `src/plugins/comments/comments.ts:105`. `plugin.me` returns `ctx.me` (`src/services/plugins/runtime.ts:209`), which can change during the TUI (`src/services/context.ts:60`); the roster can also change.

**Recommended change:** document `plugin.me` as the locally selected handle, possibly stale, with author-producing mutations checking current roster membership. Keep the two short checks for now. If extracting shared behavior, expose an asynchronous `currentAuthor()` that reevaluates the current handle and roster per call; do not change the synchronous getter to a promise or cache one resolved author for a context's lifetime. The previous recommendation would become stale after whoami or roster edits.

**Acceptance:** later changes of Me/roster affect the next created Story and Comment; unknown Me records null authors as today. **Dependencies / conflicts:** ARCH-37 synchronizes context and preserves git-derived Me; no dependency on a new author API. Owner: Documentation, optional consumer refactor. Preserve current behavior.

### <a id="arch-19"></a>ARCH-19 — Plugin form field/value declarations duplicate core form declarations

**Severity:** nit. **Priority:** optional type cleanup. **Status:** confirmed.

**Evidence:** `src/services/plugins/types.ts:394` mirrors `src/tui/components/Form.tsx:8` / `:21`, adding an initial `value`; `src/tui/screens/stories/pluginFields.ts:35` copies the declaration directly into Form fields.

**Recommended change:** add a compile-time assignability check between `PluginFormField` and `FormField`, and between their value types, so drift is caught. If surface types are moved under ARCH-01, use `PluginFormField = FormField & {value?:FormValue}` there. Do not create an upward runtime import into services merely to remove seven lines of type duplication.

**Acceptance:** a newly added FieldKind or value alternative cannot leave the plugin contract silently behind. **Dependencies / conflicts:** optional ARCH-01 type move; ARCH-40 validates actual field names separately. Owner: TUI / Pipeline type agreement.

### <a id="arch-20"></a>ARCH-20 — Timestamp conversion is repeated in mutation consumers

**Severity:** nit. **Priority:** optional convenience; no current bug. **Status:** confirmed repetition, corrected scope.

**Evidence:** Epics converts `plugin.now()` at `src/plugins/epics/service.ts:38`, `:51`, `:59`; Comments does so at `src/plugins/comments/comments.ts:50`, `:66`, `:88`. Comments also legitimately uses Date directly for display (`src/plugins/comments/CommentsTab.tsx:77`).

**Recommended change:** retain injectable `now():Date` and exported `toTimestamp` as-is. A plugin-local timestamp helper can remove repeated conversion. Add `timestamp():Timestamp` to the public context only if repeated demand justifies another API member; the previous statement that `now()` is always converted was false.

**Acceptance:** no loss of deterministic clock injection, and relative-time display still receives Date. **Dependencies / conflicts:** none. Owner: Plugin consumers if desired; do not expand the framework solely for this nit.

### <a id="arch-21"></a>ARCH-21 — Custom doctor checks cannot inspect Local State through DoctorData

**Severity:** minor. **Priority:** useful completeness fix for an advertised bag scope. **Status:** confirmed.

**Evidence:** `src/services/plugins/types.ts:342` contains config/boards/stories only. Doctor already has LocalState (`src/services/doctor.ts:445`) and validates local bag schemas (`:526`), but passes custom checks only `data` (`:536`).

**Recommended change:** add `local:LocalState` to DoctorData and include it when building the valid snapshot (`src/services/doctor.ts:428`). Keep its existing schema-check behavior. No separate file enumeration API is needed for this issue.

**Acceptance:** a fixture plugin custom check reads and fixes a local preference; disabled local data remains unchecked/preserved; malformed local.json follows the existing core doctor policy. **Dependencies / conflicts:** ARCH-09 same doctor loop, ARCH-37 synchronization after fix. Owner: Doctor with Pipeline type agreement.

### <a id="arch-22"></a>ARCH-22 — CLI and TUI Board resolution have different, appropriate responsibilities

**Severity:** nit. **Priority:** optional documentation; previous simplification withdrawn. **Status:** confirmed distinction, not a defect.

**Evidence:** CLI env resolves through `boardFlag` (`src/commands/plugins.ts:134`, `src/commands/_shared.ts:35`); TUI resolves from service context (`src/plugins/specs/SpecsScreen.tsx:21`). Specs injects the CLI resolver into `resolveTarget` (`src/plugins/specs/specs.ts:49`), and resolves a Story's Board without invoking it when `--story` is present (`:55`).

**Recommended change:** document that env resolution incorporates `ROWBLY_BOARD`, while services receive an explicit selector/context. Keep the injected callback and Story-first branch. The former proposal to eagerly evaluate `env.resolveBoard` before `resolveTarget` would break `--story` on a Data Root with several Boards and no selected Board, and could create a false board/story option conflict.

**Acceptance:** `specs show --story WEB-1` does not require current Board selection or honor an unrelated `ROWBLY_BOARD`; Board Specs retain flag/env/context precedence. **Dependencies / conflicts:** none. Owner: Documentation / Specs. Do not implement the former eager-resolution change.

### <a id="arch-23"></a>ARCH-23 — Reactions receive a live, shallow-readonly Change Set

**Severity:** minor. **Priority:** useful protection of event evidence. **Status:** confirmed mutable references; cross-reaction distortion inferred.

**Evidence:** `src/services/plugins/changeSet.ts:156` returns the same list and records; `src/services/plugins/types.ts:92` protects only array assignment, not nested fields; `src/services/plugins/runtime.ts:121` gives each reaction that live view.

**Recommended change:** create a deep-frozen snapshot once after successful save, and build `story`/`board` lookups over that snapshot for all reactions. Keep the collecting Change Set private. Type reaction changes and record values deeply readonly. Mutating the snapshot should fail or be ineffectual, preserving data seen by subsequent reactions. This is evidence isolation, not a third-party security boundary.

**Acceptance:** a mutation attempted by reaction A cannot alter reaction B's event; disk is unchanged; snapshots include final transforms and remain stable during delayed TUI reactions. **Dependencies / conflicts:** ARCH-39 needs a similar read-only snapshot before guards; share helpers rather than duplicating clone/freeze code. Owner: Pipeline.

### <a id="arch-24"></a>ARCH-24 — Late surface failures are not fully reconciled with load-time claims

**Severity:** minor. **Priority:** useful loader consistency fix. **Status:** confirmed behavior; no current built-in attach failure.

**Evidence:** `src/commands/plugins.ts:103` silently skips a missing path; its `commands()` failure calls markFailed (`:96`) after all plugins' claims were already settled. `src/services/plugins/host.ts:116` removes active status but cannot reconsider a later plugin already rejected for a clash.

**Recommended change:** treat a missing declared option command as a host/program contract error; prevalidate option destinations before adding the command group or any flags, then attribute failure to the plugin. Stage complete registration under WP06 before attaching it to the live program. Document whether late command/TUI failures reconsider previously rejected plugins during the same run; the current behavior does not. Do not simply release a Set claim: that would not reactivate a skipped plugin, and partial Commander mutations would still need handling.

**Acceptance:** deliberately inconsistent reserved-name/program fixtures produce an explicit failure with no partial plugin command/options; throwing `commands()` leaves no attached group; late-failure clash behavior is documented/tested. **Dependencies / conflicts:** ARCH-16 command list; ARCH-40 option prevalidation. Owner: Loader / CLI. The earlier release-claims proposal is narrowed to avoid an incomplete retry mechanism.

**Supervisor disposition:** WP06 requires staging each plugin's complete registration. Implement that coordinated boundary now; the earlier conditional suggestion to defer complete surface staging is superseded. Whether a later plugin rejected before a late failure is retried remains a separately documented deterministic policy, rather than an accidental consequence of deleting a claim.

### <a id="arch-25"></a>ARCH-25 — Specs routes have generic or inherited breadcrumb titles

**Severity:** nit. **Priority:** useful consumer polish; screen descriptor abstraction optional. **Status:** confirmed title fallback.

**Evidence:** `src/tui/hooks/plugins.ts:33` defaults to capitalized screen keys and lets params override title. Specs opens form/detail without titles (`src/plugins/specs/SpecsScreen.tsx:37`, `:49`, `src/plugins/specs/SpecTab.tsx:29`); its detail spreads target params into edit (`src/plugins/specs/SpecDetailScreen.tsx:19`). `src/tui/screens/plugins/PluginScreen.tsx:10` passes title through as ordinary params.

**Recommended change:** pass explicit titles at Specs call sites: `New Spec`, `Edit <slug|KEY>`, and a meaningful detail title. Document `title`, `plugin`, and `screen` as reserved route metadata. Keep the lightweight screen map. A descriptor with title callbacks is unnecessary for three consumers. Strip title before passing business params only if the adapter contract is changed consistently; its current pass-through is not an unexplained data leak.

**Acceptance:** breadcrumbs identify the document and action, and editing a detail does not inherit a misleading detail title. **Dependencies / conflicts:** ARCH-07 core navigation should use the same title policy. Owner: Specs with TUI adapter owner; no major route API required.

### <a id="arch-26"></a>ARCH-26 — Plugins reload on both deactivation and return, and repeat local confirmations

**Severity:** minor for unnecessary reloads; nit for dialog duplication. **Priority:** useful helper export; generic confirmation API optional. **Status:** confirmed repetition, no missing deletion confirmation claimed.

**Evidence:** active state is a `useAsync` dependency at `src/plugins/epics/EpicDetail.tsx:20`, `src/plugins/specs/SpecTab.tsx:17`, `src/plugins/specs/SpecsScreen.tsx:26`, and `src/plugins/comments/CommentsTab.tsx:30`. Core's `useReloadOnReturn` lives at `src/tui/screens/stories/shared.tsx:18` and is not exported by `src/plugin-api/tui.ts:21`. ConfirmDialog is already exported (`src/plugin-api/tui.ts:9`); local confirm/busy state appears at EpicDetail `:21` and CommentsTab `:26`. Shell's overlay supports only quit/back (`src/tui/shell/Shell.tsx:31`, `:214`).

**Recommended change:** move `useReloadOnReturn` into `src/tui/hooks/useReloadOnReturn.ts`, export via its barrel and Plugin API, and migrate consumers that only need return refresh. Allow a caller-provided active flag for tabs. Keep private dialog state unless a shared hook proves useful. Do not describe `ui.confirm()` as using an existing general shell confirmation service: none exists; implementing one needs request lifetime/cancellation and input-focus work.

**Acceptance:** opening a child form does not refetch the inactive parent unnecessarily; returning after save refreshes it; changing record/Board still refreshes; confirmation cancels safely and handles busy state. **Dependencies / conflicts:** ARCH-07 navigation, ARCH-25 titles. Owner: TUI, follow-up per plugin. Respect one component per file; helper belongs in hooks.

### <a id="arch-27"></a>ARCH-27 — Persisted plugin format evolution needs a stated policy

**Severity:** minor. **Priority:** useful format-ownership documentation; formal external compatibility is a P3 gate before third-party loading; generic migration hooks optional. **Status:** confirmed differing format mechanisms; future migration need inferred.

**Evidence:** Epic JSON has literal version 1 (`src/plugins/epics/model.ts:4`); Comments and Specs bags have no version (`src/plugins/comments/model.ts:13`, `src/plugins/specs/specs.ts:14`). Generic doctor only reports schema mismatch (`src/services/doctor.ts:512`). Earlier removal migrations are explicitly excluded (`docs/PLUGINS.md:122`, `docs/adr/0018-comments-are-a-built-in-plugin.md:9`).

**Recommended change:** document plugin ownership of bag/file formats and a compatibility policy: unknown/disabled data remains opaque; an incompatible new bag shape must retain old-shape recognition until an explicit doctor fix or plugin migration command can migrate it without data loss; migration is never inferred from `readBag` returning undefined. JSON plugin files may carry their own version, Markdown need not. Do not claim doctor automatically migrates malformed/unreadable files: current plugin checks mainly receive core-valid records. Plugins implementing a migration must use raw own bags/files and explicitly handle each supported old shape. Fix existing invalid-data loss under ARCH-36 before built-in release; a general external compatibility/migration framework is a separate milestone under WP10.

**Acceptance:** policy includes a worked old/new bag example and an atomic pre-save rejected-migration test; old disabled bags remain unchanged. Current Epic/Specs/Comments keys remain `epic`, `specs`, and `comments`, respectively; no evidence justifies renaming them. **Dependencies / conflicts:** ARCH-36 distinguishes absent/invalid data; ARCH-09 attributes migration findings; ARCH-41 states save failure limits. Owner: Documentation with plugin consumers. No generic migration lifecycle hook now.

### <a id="arch-28"></a>ARCH-28 — Startup constructs core Commander declarations twice and activates plugins for version queries

**Severity:** nit. **Priority:** optional startup improvement. **Status:** confirmed work; measurable performance impact not established.

**Evidence:** `src/main.ts:38` builds a core program for reservations, then `src/main.ts:126` builds again after loading; `src/main.ts:125` also activates enabled plugins for version/help/init invocation. No benchmark establishes this as a material bottleneck.

**Recommended change:** keep deriving reservations from actual core command declarations rather than replacing them with another drifting table. Cache immutable reservations per process if repeated TUI reloads make it useful. A fast path for a parsed standalone version query can skip activation; do not use only `argv[0]`, since globals can precede commands. Do not skip normal help, which needs enabled plugin commands/options, or indiscriminately skip init, which also runs against existing roots.

**Acceptance:** version behavior is unchanged with globals before/after the flag; help retains plugin surfaces; reservations cannot be mutated by callers. **Dependencies / conflicts:** ARCH-16 authoritative destinations. Owner: Loader / CLI. Optimization is not a release blocker.

### <a id="arch-29"></a>ARCH-29 — Simultaneous test runs share build outputs

**Severity:** minor. **Priority:** useful validation-infrastructure fix; supervisor serialization is sufficient for this work plan. **Status:** confirmed shared paths; historical flake cause inferred.

**Evidence:** `test/helpers/globalSetup.ts:11` rebuilds the main CLI; `:25` writes `.test-dist`; `tsup.config.ts:9` cleans `dist`; `test/helpers/runCli.ts:7` / `:9` spawn fixed paths. The earlier failures/pass sequence is recorded above.

**Recommended change:** for current parallel execution, let the supervisor run the suite once after source edits settle, as requested. If concurrent independent suites must be supported later, build main and fixture CLIs into per-run temporary directories, pass paths using Vitest provided context, and clean only those owned directories after the suite. An alternative lock must cover build **and the full consuming suite**, not just compilation: another run can clean outputs while the first is still testing.

**Acceptance:** two simultaneous suites cannot remove each other's binaries; teardown removes only owned outputs. Until implemented, orchestration explicitly serializes checks. **Dependencies / conflicts:** test-build owner controls globalSetup/runCli and fixture path re-exports (`test/plugins/helpers.ts`); consumers should not each patch build paths. Do not state that concurrency definitely caused the first historical failures.

### <a id="arch-30"></a>ARCH-30 — Epic link guards read stored files rather than pending files

**Severity:** minor. **Priority:** useful pipeline-consumer correctness fix. **Status:** confirmed mismatch; composite-operation consequence inferred.

**Evidence:** `src/plugins/epics/index.ts:15` uses `plugin.files.read` in a guard; Specs uses `changes.readFile` (`src/plugins/specs/index.ts:36`) to see pending updates.

**Recommended change:** pass the Change Set's read-only file view into `guardLink`, and read the requested Epic through it. Document that handler file reads use the pending view; ordinary commands/screens use stored `plugin.files`. Keep it compatible with ARCH-39's guard read API.

**Acceptance:** a replacement that creates or deletes an Epic file in the same Story-create Change Set is seen by the Epic guard; no stored read falsely accepts a pending deletion or rejects a pending creation. **Dependencies / conflicts:** ARCH-39 changes guard context; ARCH-38 resolves file scopes. Owner: Epics consumer after Pipeline signature agreement.

### <a id="arch-31"></a>ARCH-31 — Commander handlers repeatedly pass their trailing Command to `cli.run`

**Severity:** nit. **Priority:** optional abstraction, not a defect. **Status:** confirmed boilerplate.

**Evidence:** `src/services/plugins/types.ts:294`, `src/plugins/specs/commands.ts:37`, and command declarations in `src/plugins/epics/commands.ts` / `src/plugins/comments/commands.ts` use the explicit adapter.

**Recommended change:** retain `cli.run(cmd,action)` for this release. It makes Commander arguments and error/IO context clear. Add `cli.action` only if a concrete ergonomic need outweighs typing variable positional arguments and options; no such defect was demonstrated. Document one concise command example instead of expanding the public API to hide a line.

**Acceptance:** existing adapters still provide confirmation, warnings, globals, and expected exit mapping. No extra tests or public wrapper required. **Dependencies / conflicts:** ARCH-04 and ARCH-05 must preserve env behavior. Owner: Loader / CLI; explicitly avoid speculative convenience work.

### <a id="arch-32"></a>ARCH-32 — Several extension points are fixture-tested rather than built-in-used

**Severity:** nit. **Priority:** keep existing abstractions; useful missing-wiring tests under ARCH-16. **Status:** confirmed usage inventory.

**Evidence:** replacement is exercised by Stamp (`test/plugins/fixtures/others.ts:9`, `test/plugins/pipeline.test.ts:100`); start by Boom (`test/plugins/fixtures/others.ts:34`, `test/plugins/load.test.ts:31`); a settings link by Notes (`test/plugins/fixtures/notesTui.tsx:36`, `test/plugins/tui.test.tsx:126`). No built-in declares assignee/local bag schemas. ADR-0016 explicitly anticipates Local State preferences.

**Recommended change:** keep replacement, start, settings links, and advertised bag scopes. Being unused by three built-ins is not a defect when the fixture tests establish their behavior. Add Board/Task/Assignee CLI wiring coverage through ARCH-16; do not build the future Git plugin or remove existing capabilities to achieve usage purity.

**Acceptance:** existing fixture coverage remains; missing cross-command wiring coverage is consolidated in one task. **Dependencies / conflicts:** ARCH-16 is the test owner; ARCH-21/37 make local scope reliable. Owner: Documentation / validation. Earlier minor/generalized concern is reduced to an inventory and specific tests.

### <a id="arch-33"></a>ARCH-33 — Guard's return type redundantly includes undefined

**Severity:** nit. **Priority:** optional cleanup. **Status:** confirmed.

**Evidence:** `GuardResult` already includes undefined (`src/services/plugins/types.ts:202`), repeated in the callback type at `:206`.

**Recommended change:** while editing guard signatures for ARCH-39, use `GuardResult | Promise<GuardResult>`. No behavior change or standalone test is needed.

**Acceptance:** sync/async guards with no verdict compile exactly as before. **Dependencies / conflicts:** fold into ARCH-39; do not assign another agent to the same type block. Owner: Pipeline.

### <a id="arch-34"></a>ARCH-34 — Core invokes generic plugin definitions in several service modules

**Severity:** nit. **Priority:** optional abstraction; current design should be kept. **Status:** confirmed generic dispatch, not a core/plugin domain leak.

**Evidence:** filters are dispatched at `src/services/stories.ts:265`; rows at `src/services/plugins/service.ts:84`; doctor checks at `src/services/doctor.ts:504`. No module imports Epics/Specs/Comments; registry isolation is enforced at `test/architecture.test.ts:147`.

**Recommended change:** keep these generic loops in their relevant service modules. Host should remain loading/status management; moving row/filter/doctor execution onto it would add context/callback coupling and responsibility. Extract a small dispatch/error-attribution helper only if the same failure policy is deliberately shared. Preserve the ban on built-in plugin imports in core.

**Acceptance:** architecture import tests remain enforced; generic filters/rows/checks work in registry order. **Dependencies / conflicts:** do not implement new host `filter()/rows()/doctors()` methods as part of ARCH-01. Owner: no source task required; retain in the execution plan as a correction.

### <a id="arch-35"></a>ARCH-35 — Plugin settings have no generic in-app write surface

**Severity:** minor. **Priority:** useful documentation; generic settings editor optional. **Status:** confirmed current capability; the gap is documentation.

**Evidence:** CLI shows settings (`src/commands/plugins.ts:52`) and toggles enablement (`:62` / `:72`); TUI toggles (`src/tui/screens/plugins/PluginsScreen.tsx:20`); plugin settings links exist (`src/services/plugins/types.ts:462`) but no built-in uses one. A required schema such as Strict's cannot be enabled without providing its values by hand (`src/services/plugins/service.ts:34`, `test/plugins/fixtures/others.ts:44`).

**Recommended change:** explicitly document manual editing of root/Board plugin settings, list replacement and object merge semantics, restart/reload behavior, and the fact that `plugins show` reports stored settings rather than all schema defaults/effective Board settings. Plugins needing an interactive settings flow can supply their own CLI/TUI editor through existing operations. Do not derive a generic Form from arbitrary Zod schemas or add a string-key JSON setter without an actual consumer.

**Acceptance:** a user can follow the docs to supply a required setting and enable the plugin; invalid settings remain detectable; manual edits preserve `enabled`. **Dependencies / conflicts:** ARCH-08 root writer contract, ARCH-27 format policy. Owner: Documentation. No new public settings command required now.

### <a id="arch-36"></a>ARCH-36 — Invalid bags look absent and can be overwritten by ordinary mutations

**Severity:** major. **Priority:** release blocker (data preservation). **Status:** confirmed by source-level probe.

**Evidence:** `src/services/plugins/runtime.ts:185` returns undefined for both absent and invalid bags. Comments treats it as an empty thread (`src/plugins/comments/comments.ts:31`) and writes a new bag (`:89`); Specs treats it as no links (`src/plugins/specs/specs.ts:110`); Epics treats it as no Epic (`src/plugins/epics/service.ts:65`). Doctor only warns (`src/services/doctor.ts:529`). The probe seeded `{comments:[{id:'old',body:123}]}` and adding a Comment persisted only the new Comment, removing the malformed stored thread.

**Recommended change:** retain a tolerant read for display if desired, but add a strict mutation read, e.g. `requireBag(record,schema):T|undefined`, returning undefined only when absent and throwing DATA_INTEGRITY with plugin attribution/issues when present-invalid. Use it in Comments mutations and Specs additive/removal mutations; reject destructive overwrite of invalid data unless an explicit repair/replacement is requested. Keep `writeBag`'s explicit removal semantics. Doctor checks must inspect raw bags to repair invalid data intentionally rather than relying on tolerant reads. When fields/edit forms display invalid bags, surface the problem and prevent default values from silently replacing them on an unrelated edit. WP05 should track dirty own fields, gather edit input only from successfully loaded providers whose fields changed, and distinguish omitted input from an explicit clear; a failed or unchanged provider must never synthesize clearing input.

**Acceptance:** malformed Story and Task threads survive rejected add/edit/remove unchanged; invalid Specs links survive additive edits unchanged; absence still allows creation; explicit doctor repair can operate on raw values; unrelated core writes keep invalid opaque bags. **Dependencies / conflicts:** ARCH-04 expected data-integrity handling, ARCH-12 error export, ARCH-27 migration policy. Owner: Pipeline provides helper; separate Plugin consumers integrate it. Conflicts with any schema migration that assumes invalid means empty.

### <a id="arch-37"></a>ARCH-37 — Local State plugin writes are later clobbered by stale in-memory state

**Severity:** major. **Priority:** release blocker (advertised bag scope loses data). **Status:** confirmed by source-level probe.

**Evidence:** `src/services/plugins/changeSet.ts:125` correctly reads pending/stored state. But `src/services/context.ts:31` discards that argument and rewrites from `ctx.local`. Plugin operations writing local bags do not update `ctx.local` after save (`src/services/plugins/runtime.ts:114`). Context methods and Board deletion assign body-time return values later (`src/services/context.ts:32`, `src/services/boards.ts:78`), which can omit a transform's updated bags. Existing preservation tests start with the bag already in `ctx.local` (`test/plugins/bags.test.ts:53`), missing this case.

**Recommended change:** context mutations must update the latest state supplied by the Change Set, not `ctx.local`. After a successful save, have one runner-owned synchronization step copy the final local change into `ctx.local` before reactions. Update `ctx.me` only when the stored Me selection changes, preserving inferred git-email identity when only Board/preferences change; document precedence. Remove late assignments of stale body results in context/Board services; synchronize doctor fixes and arbitrary plugin operations through the same mechanism. No synchronization on rejection/save failure.

**Acceptance:** write a local plugin preference, then use/clearUse/setMe/delete the selected Board/doctor fix; preference remains. A transform adding a local bag during those operations remains on disk and in context; reactions see final context. Git-derived Me survives unrelated preference changes; changing/clearing Me is reflected correctly. **Dependencies / conflicts:** ARCH-14 public runner results, ARCH-42 result finalization. Owner: Pipeline plus Core services, Doctor integration. This shared fix must not be independently reimplemented in each service.

### <a id="arch-38"></a>ARCH-38 — Plugin file scopes ignore pending Board creation and fall back through pending deletions

**Severity:** major. **Priority:** release blocker (Change Set lifecycle correctness). **Status:** confirmed by source-level probes.

**Evidence:** `src/services/plugins/changeSet.ts:243` supplies only a pending Story resolver; `:254` resolves Boards solely on disk. `:256` falls back to disk when a Story is pending-deleted because null also means no pending record. Save deletes records and then writes later file changes (`:177`, `:190`, `:195`). The probes showed `boards.create` cannot add a file for its new Board, and `stories.remove` can recreate a folder containing an orphan plugin file after deleting story.json.

**Recommended change:** resolve scopes using explicit pending states: absent / present / deleted for both Board and Story. Reads of a pending-deleted scope return an absent result according to a documented rule; writes to it are rejected before save. Permit a pending-created Board/Story's files in the same operation. Before saving, reject inconsistent final plans that write records/files beneath a deleted parent. Store plugin ID, relative filename, and private owner identity in pending file entries; derive paths from final owner state at commit preparation so subsequent renumbering moves queued files with their owner. This implements README decision 5; the earlier fallback of rejecting an otherwise valid renumbered scope is not the selected contract. Do not revive deleted parents via filesystem mkdir.

**Acceptance:** file write during Board creation succeeds in the same commit. Story/Board deletion never recreates their folders. Cover pending create/delete, deleting parent after staging a file, nested Story under removed Board, and renumber-before/after staging file; both staged and existing plugin files finish under the final owner. **Dependencies / conflicts:** ARCH-30 pending reads, ARCH-41 save prevalidation. Owner: Pipeline (WP02 changeSet), with WP04 scope-type agreement. This does not require enumerating every cascaded file deletion as a FileChange.

### <a id="arch-39"></a>ARCH-39 — Guards get writer methods and can modify the supposedly final Change Set

**Severity:** major. **Priority:** release blocker (guard/transform separation). **Status:** confirmed by source-level probe.

**Evidence:** `OperationEvent.changes` is `PluginChangeSet` for guards and transforms (`src/services/plugins/types.ts:190`, `:206`). Runtime supplies `forPlugin` to both (`src/services/plugins/runtime.ts:72`, `:104`). The probe guard mutated `changes.changes[...].after.name` and the persisted Story became `Changed by guard`. Writer methods are also directly available. A later guard can therefore change what earlier guards already approved.

**Recommended change:** define `PluginChangeSetView extends ChangeSetView` with own scoped `readFile` but no writers. Give guards a deep-readonly snapshot/view plus read-only services; transforms/replacements/bodies retain writers. Expose deep-readonly record changes even to transforms so all changes go through validated writer methods. Guards must not hold live mutable aliases into the collector; cloning/freezing the view is necessary beyond removing methods. Bind writer handles to their permitted invocation lifetime and seal the collector before guards/commit; a retained transform writer used later must reject before altering the collector. Enforce this at the writer methods as well as at operation entry: ARCH-06's nested-operation check alone cannot stop a captured `changes.updateStory` call.

**Acceptance:** mutation methods are compile-time errors in guards; runtime attempts to alter returned records cannot change saved state or another guard's observations; a retained transform writer used in a guard, reaction, or late continuation fails without changing the plan; pending readFile still sees final transforms; rejection prevents save/reactions. **Dependencies / conflicts:** ARCH-03 event split, ARCH-06 async execution scope, ARCH-23 snapshot helper, ARCH-30 Epics guard signature, ARCH-33 return cleanup. Owner: Pipeline; consumer/doctor callbacks follow one agreed phase contract.

### <a id="arch-40"></a>ARCH-40 — Namespacing does not make every declared UI name or option unique

**Severity:** major (malformed-option startup failure; UI identity issues are minor). **Priority:** P1 registration/route correctness. **Status:** confirmed source behavior and read-only Commander probe; no built-in label collision currently.

**Evidence:** Home uses label as SelectList value and finds the first matching destination (`src/tui/screens/home/index.tsx:26`, `:29`), so a plugin entry labeled `Stories` selects the core entry. Settings section IDs use plugin ID plus label (`src/tui/screens/settings/sections.ts:49`); duplicate labels within a plugin share identity. Tabs key on ID+label (`src/tui/screens/stories/detail.tsx:137`, `src/tui/screens/tasks/TaskDetailScreen.tsx:137`). Fields prefix plugin IDs but duplicate own names overwrite values (`src/tui/screens/stories/pluginFields.ts:34`). Host flag validation checks only previous claims, not repeated flags within the same declaration (`src/services/plugins/host.ts:194`). Its regex (`:178`) admits `--foo--bar` and `--foo-bar-`, both of which throw TypeError in Commander's `attributeName()` in the retained probe. `--foo-1-bar` / `--foo1-bar` both map to `foo1Bar` while claiming different raw bases. Option attachment is outside the commands callback try/catch (`src/commands/plugins.ts:101`, `:107`, `:108`), so malformed admitted options can abort program construction rather than mark just their plugin failed. `loadTuiPlugins` does not validate link targets (`src/tui/loadPlugins.ts:15`).

**Recommended change:** Home routes by a stable value such as `core:<screen>:<index>` or `plugin:<id>:<index>`, with label only for display. Validate duplicate local field names, settings IDs, tab labels/IDs, missing linked screens, and repeated CLI long flags/Commander attribute names. Reject empty or trailing kebab segments before constructing/attaching options, and compute/check Commander attributes inside attributed registration validation. Allow the intentional positive/negative pair `--x` and `--no-x`; do not reject that pair merely because normalized bases match. Perform checks at the relevant declaration load/field collection boundary and attribute errors to the plugin.

**Acceptance:** two same-label home entries navigate independently; own duplicate field names fail clearly; a valid positive/negative flag pair loads; repeated positive flags or same-attribute spellings fail; `--foo--bar` and `--foo-bar-` fail only their plugin before any registration, leaving core and healthy plugin commands usable; nonexistent linked screens fail load rather than becoming a broken destination. **Dependencies / conflicts:** ARCH-13 reservations, ARCH-16/24 staged attachment. Owner: TUI for UI declarations; Loader / CLI for flags. Do not have both owners edit host/type blocks independently.

### <a id="arch-41"></a>ARCH-41 — One save phase does not mean a filesystem transaction

**Severity:** major. **Priority:** P0 release blocker under the supervisor's selected recovery guarantee. **Status:** confirmed sequential writes; I/O failure consequences inferred from control flow by this reviewer, and independently reproduced by the resilience reviewer as reported in README.

**Evidence:** `src/services/plugins/changeSet.ts:175` moves folders before writing; `:177` saves each record/file sequentially with no rollback. `src/storage/files.ts:47` stages folder renames without recovery on an intermediate failure. Per-file JSON writes are atomic (`src/storage/jsonStore.ts:48`), which does not make a multi-record unlink/delete atomic. Epics deletion updates Stories before deleting its file (`src/plugins/epics/service.ts:77`); Specs deletion stages the file before unlinking Stories (`src/plugins/specs/specs.ts:124`).

**Recommended change:** document the current baseline accurately: hook/body rejection before commit writes nothing, while an I/O failure during commit can leave partial persistence. Implement README decisions 1–2 under WP02: coordinate from operation state reads through commit; prevalidate the complete final plan; stage writes/moves/deletes; record a durable recoverable manifest/journal; recover idempotently. Define guarantees for participating Rowbly readers and external edits. Validate record schemas, parent lifecycle, private source identities, duplicate target moves, and occupied destinations, covering ARCH-38/39 inconsistencies. Report save-stage errors distinctly with affected paths and recovery guidance. Preserve file-backed storage. The earlier conditional recommendation to accept documented partial-write limits is **superseded**, not an alternative for execution under the chosen release guarantee.

**Acceptance:** invalid final plans fail before any filesystem mutation; reactions never run after save failure; docs distinguish pre-save, commit, and recovery behavior. Use WP02's failure-injection and subprocess-death tests to establish complete old/new recovered state, idempotency, distinct concurrent allocations, and the participating-reader visibility guarantee. **Dependencies / conflicts:** ARCH-06 enforcement precedes non-reentrant lock integration; ARCH-38 logical scope plans; ARCH-39 private identity and sealing; ARCH-23 reaction snapshot created only after successful save. Owner: WP02, integrating with WP01/WP04. Overlaps resilience findings; one implementation must own commit semantics. No second journal/lock implementation under an architecture task.

### <a id="arch-42"></a>ARCH-42 — Final result refresh is opt-in and incomplete

**Severity:** major (local-state/public-result inconsistencies). **Priority:** release blocker for the stated result contract; execution priority follows WP04 except the Local State preservation portion in WP02/P0. **Status:** confirmed implementation; transformed plugin-result mismatch inferred from the missing finalizer.

**Evidence:** finalization happens only when a caller supplies `latest` (`src/services/plugins/runtime.ts:113`). Story/Task and Board services supply finalizers, but context does not (`src/services/context.ts:31`), stage methods return pre-transform arrays (`src/services/stages.ts:19`, `:32`), and own plugin operations cannot supply a finalizer (`src/services/plugins/types.ts:255`, `src/services/plugins/runtime.ts:205`). Comments returns a created/updated Comment before other plugins transform its bag (`src/plugins/comments/comments.ts:55`, `:71`). Specs returns undefined from its operation body, then separately rereads for the command result (`src/plugins/specs/specs.ts:101`, `:107`). PLUGINS.md states returned records are read back after transforms (`docs/PLUGINS.md:171`).

**Recommended change:** inventory final result semantics alongside ARCH-14. Provide concrete finalizers for returned core records/arrays and LocalState. Add an optional own-operation `result(changes,bodyResult)` finalizer after transforms if plugin-owned returned records need it; implement Comment finalization by locating the saved Story/Task bag and Comment ID. A finalizer is a pure read of pending data, not another write/read-to-disk step. State what happens if a transform removes a returned entity: fail before save or return a documented nullable/removal result; do not silently return the unsaved old record. There is no need for result schemas or a generic entity locator framework.

**Acceptance:** a fixture transform changing a Stage, LocalState, and Comment produces the same final value for caller and reaction as persisted data; Specs' emitted result is deliberately defined; removal of the operation's returned entity follows the documented rule. **Dependencies / conflicts:** ARCH-03 pre-save vs final result, ARCH-14 true types, ARCH-37 local synchronization, ARCH-36 strict Comment parsing. Owner: Pipeline/Core services, with Comments/Specs owners after signature agreement.

### <a id="arch-43"></a>ARCH-43 — One TUI edit submission can commit twice and partially succeed

**Severity:** major. **Priority:** release blocker if the documented one-user-action guarantee is retained. **Status:** confirmed two-operation flow; partial outcome under a move guard inferred directly from ordering.

**Evidence:** Story form awaits `stories.update`, including plugin inputs, then calls `stories.move` (`src/tui/screens/stories/form.tsx:58`, `:59`). Task form does likewise (`src/tui/screens/tasks/TaskFormScreen.tsx:32`, `:33`). The update has already saved and reacted when the move guard can reject. ADR-0012 describes one user action as one Change Set (`docs/adr/0012-plugins-intercept-service-operations.md:7`).

**Recommended change:** make form edits including Stage changes one service operation. A small extension is `stage?:Slug` on StoryPatch/TaskPatch, handled by update with existing Stage validation and Story destination-rank allocation when the Stage changes; the CLI can retain separate move commands and optionally expose the same edit capability. State that hooks interested in Stage transitions inspect before/after changes, including `stories.update`, rather than only `stories.move`. Refactor pure move/rank calculation locally as needed; do not call a nested public service operation from update. Alternatively narrow the documented guarantee explicitly, but that leaves a visible partial-edit behavior requiring UI explanation.

**Acceptance:** a rejecting Stage-transition guard prevents title, plugin bags, and Stage from changing for the form submission; successful edit saves/reacts once; unchanged Stage preserves rank; moving through edit appends to the destination correctly; CLI/TUI service behavior agrees. **Dependencies / conflicts:** ARCH-06 nested operation enforcement, ARCH-02 operation intent documentation, ARCH-14 typed inputs, ARCH-41 commit limits. Owner: Core services plus TUI. This touches Story/Task forms and must be coordinated with plugin form/operation work in other reviews.

## Retained reproduction evidence

These scripts are part of this report, not additional repository files. Run from the repository root. They use disposable `/tmp` Data Roots, current source through tsx, and no global setup/build/test runner. Results below are from this review. Re-running while implementation is underway may correctly produce changed results.

```sh
node --import tsx --input-type=module <<'JS'
import { mkdtemp, readFile, writeFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServices, loadPlugins } from './src/services/index.ts';
import { definePlugin } from './src/plugin-api/index.ts';
import { comments } from './src/plugins/comments/index.ts';
import { addComment } from './src/plugins/comments/comments.ts';
const reserved = { commands: [], options: {}, keys: [] };
async function fixture(defs) {
  const dir = await mkdtemp(join(tmpdir(), 'rowbly-architecture-probe-'));
  const path = join(dir, '.rowbly');
  const ctx = {
    root: { path, kind: 'local' }, local: { version: 1 }, me: null,
    now: () => new Date('2026-10-13T00:00:00.000Z'),
    newId: () => 'probe001', warn: () => {},
  };
  await createServices(ctx).setup.init({
    root: ctx.root, board: { id: 'web', name: 'Web', keyPrefix: 'WEB' },
  });
  const configPath = join(path, 'rowbly.config.json');
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  config.plugins = Object.fromEntries(defs.map(d => [d.id, { enabled: true }]));
  await writeFile(configPath, JSON.stringify(config));
  ctx.plugins = await loadPlugins({ root: ctx.root, registry: defs, reserved });
  return {
    ctx, services: createServices(ctx),
    clean: () => rm(dir, { recursive: true, force: true }),
  };
}
async function probe(name, defs, body) {
  const f = await fixture(defs);
  try { console.log(name, JSON.stringify(await body(f))); }
  catch (e) { console.log(name, JSON.stringify({ code: e.code, message: e.message })); }
  finally { await f.clean(); }
}
await probe('guard-can-mutate', [definePlugin({
  id: 'mutator', name: 'Mutator', description: '',
  hooks: { 'stories.create': { guard: ({ changes }) => {
    changes.changes.find(c => c.type === 'story').after.name = 'Changed by guard';
  } } },
})], async ({ services }) => (await services.stories.create('web', { name: 'Original' })).name);
await probe('file-after-story-delete', [definePlugin({
  id: 'writer', name: 'Writer', description: '',
  hooks: { 'stories.remove': { transform: ({ changes, input }) =>
    changes.writeFile({ story: input.key }, 'orphan.txt', 'orphan') } },
})], async ({ services, ctx }) => {
  const story = await services.stories.create('web', { name: 'A' });
  await services.stories.remove(story.key);
  return {
    orphan: await readFile(join(ctx.root.path,
      'boards/web/stories/WEB-1/plugins/writer/orphan.txt'), 'utf8'),
    storyFileExists: await stat(join(ctx.root.path,
      'boards/web/stories/WEB-1/story.json')).then(() => true, () => false),
  };
});
await probe('file-on-new-board', [definePlugin({
  id: 'writer', name: 'Writer', description: '',
  hooks: { 'boards.create': { transform: ({ changes, input }) =>
    changes.writeFile({ board: input.id }, 'a.txt', 'A') } },
})], async ({ services }) => services.boards.create({ id: 'api', name: 'API', keyPrefix: 'API' }));
await probe('local-bag-overwritten', [definePlugin({
  id: 'localist', name: 'Localist', description: '',
})], async ({ services, ctx }) => {
  const p = services.plugins.context('localist');
  await p.operation('prefs', {}, changes =>
    changes.updateLocalState(state => p.writeBag(state, { choice: 1 })));
  const before = JSON.parse(await readFile(join(ctx.root.path, 'local.json'), 'utf8'));
  await services.context.use('web');
  const after = JSON.parse(await readFile(join(ctx.root.path, 'local.json'), 'utf8'));
  return { before, after };
});
await probe('invalid-comments-discarded', [comments], async ({ services, ctx }) => {
  const s = await services.stories.create('web', { name: 'A' });
  const file = join(ctx.root.path, 'boards/web/stories/WEB-1/story.json');
  await writeFile(file, JSON.stringify({
    ...s, plugins: { comments: { comments: [{ id: 'old', body: 123 }] } },
  }));
  await addComment(services.plugins.context('comments'), s.key, 'new');
  return (await services.stories.get(s.key)).plugins.comments;
});
await probe('fields-update-caller-result', [definePlugin({
  id: 'watch', name: 'Watch', description: '',
  hooks: { 'fields.update': { react: ({ result }) =>
    console.log('fields-update-hook-result', JSON.stringify(result)) } },
})], async ({ services }) => {
  await services.fields.add({ level: 'global' }, { key: 'cost', name: 'Cost', type: 'number' });
  return services.fields.update({ level: 'global' }, 'cost', { name: 'Estimate' });
});
JS
```

Observed output:

```text
guard-can-mutate "Changed by guard"
file-after-story-delete {"orphan":"orphan","storyFileExists":false}
file-on-new-board {"code":"INTERNAL","message":"Plugin \"writer\" failed in the transform of boards.create: Board \"api\" not found"}
local-bag-overwritten {"before":{"version":1,"board":"web","plugins":{"localist":{"choice":1}}},"after":{"version":1,"board":"web"}}
invalid-comments-discarded {"comments":[{"id":"probe001","author":null,"body":"new","createdAt":"2026-10-13T00:00:00.000Z","updatedAt":"2026-10-13T00:00:00.000Z"}]}
fields-update-hook-result {"next":[{"key":"cost","name":"Estimate","required":false,"type":"number"}],"stripped":0}
fields-update-caller-result [{"key":"cost","name":"Estimate","required":false,"type":"number"}]
```

The field-result output labels above have been clarified from the original probe; the recorded values are unchanged. The additional Commander probe for ARCH-40 is read-only:

```sh
node --input-type=module <<'JS'
import { Option } from 'commander';
for (const name of ['foo-bar', 'foo--bar', 'foo-bar-', 'foo-1-bar', 'foo1-bar']) {
  try { console.log(name, new Option(`--${name}`).attributeName()); }
  catch (error) { console.log(name, error.name + ': ' + error.message); }
}
JS
```

```text
foo-bar fooBar
foo--bar TypeError: Cannot read properties of undefined (reading 'toUpperCase')
foo-bar- TypeError: Cannot read properties of undefined (reading 'toUpperCase')
foo-1-bar foo1Bar
foo1-bar foo1Bar
```

Historical CLI evidence for ARCH-04 can be reproduced after the supervisor builds the CLI. Use a temporary parent, point `ROWBLY_ROOT` at its `.rowbly`, and select that fixture's Board explicitly. No build or test command is included here:

```sh
TASK_CLI="$PWD/dist/cli.js"
TASK_PARENT=$(mktemp -d /tmp/rowbly-cli-architecture-XXXXXX)
(
  cd "$TASK_PARENT" || exit 1
  export ROWBLY_ROOT="$TASK_PARENT/.rowbly"
  export ROWBLY_BOARD=web
  node "$TASK_CLI" init --board web --board-name Web --prefix WEB
  node "$TASK_CLI" plugins enable epics
  node "$TASK_CLI" stories create --name A --epic Auth
  printf 'invalid slug exit=%s\n' "$?"
  node "$TASK_CLI" stories create --name A --epic auth
  printf 'missing Epic exit=%s\n' "$?"
)
```

The historical outcomes were INTERNAL/exit 1 with a disable hint, then CONFLICT/exit 4. This latter script is retained as a manual recipe and was not run in this pass; it creates only the named temporary fixture and leaves it for inspection. The source-level script above cleans all successfully created fixtures.

## Corrections to the earlier report

- ARCH-01 is type coupling, not evidence that React/Ink loads at runtime through services. The proposed wholesale move and blanket type-import exemption are not required.
- ARCH-02's mixed verbs are an API naming choice. Comments' old names are explicitly ADR-approved; mandatory schema registration/renaming is optional.
- ARCH-03's first-created-Story lookup is not broken just because another transform appends a Story. It is ambiguous under differently ordered multi-record replacements.
- ARCH-04 intentionally changes a documented error policy. Expected errors can be thrown by guards; no second error-code enum is necessary.
- ARCH-06 requires async-aware phase enforcement, and reactions remain unable to write Rowbly data. A global boolean or allowing reaction mutations would weaken the intended contract.
- ARCH-08's Board/root settings convention is already documented. A structural union alone does not safely prevent root `writeBag` calls.
- ARCH-10 cannot be fixed by stripping the runner's input while operation bodies retain closed-over originals.
- ARCH-14 is stronger than unknown-type polish: actual reaction results contradict declared shapes.
- ARCH-15 does not call for a purge feature, and PLUGINS.md already states the framework is built.
- ARCH-18 must not cache roster-valid Me for the entire TUI context. ARCH-20 acknowledges Date display use. ARCH-22 retains lazy Story-first Board resolution.
- ARCH-24 releasing name claims alone cannot resurrect already skipped plugins. ARCH-25/26 do not need screen descriptors or a general shell confirm service.
- ARCH-29's concurrent-build explanation remains inferred; a build-only lock would not protect a running suite.
- ARCH-31/32/34/35 retain useful existing simplicity. Generic command wrappers, host dispatch accessors, schema-to-form editors, and unused-capability removal are not required.
- ARCH-36–43 add the preservation, pending-scope, guard, declaration, commit-limit, result, and form-submission issues established in this pass.
- ARCH-40's double-hyphen example throws rather than producing an attribute collision; the corrected collision is `--foo-1-bar` / `--foo1-bar`, as directly probed.
- After supervisor consolidation, ARCH-24 complete registration staging, ARCH-38 logical scopes, and ARCH-41 coordinated recoverable commits are required under the selected plan. Their weaker conditional alternatives are superseded. ARCH-27 formal compatibility remains a third-party gate, not a reason to delay a built-in-only release after preservation is fixed.

## Rejected and deferred proposals

These dispositions preserve the original IDs; they are not omitted work or permission to silently remove existing capabilities.

| Disposition | IDs | Recommendation to avoid or defer |
| --- | --- | --- |
| Rejected as a diagnosis; retain smaller checks | ARCH-01 | Runtime React/Ink leakage from type-only imports; wholesale host relocation as a prerequisite. |
| Deferred optional infrastructure | ARCH-02, ARCH-12, ARCH-19, ARCH-25, ARCH-27, ARCH-31, ARCH-35 | Mandatory operation-schema registry, generic JSON helpers, broad surface-type split, screen descriptor DSL, migration lifecycle, CLI action wrapper, generated settings editor. |
| Rejected implementation | ARCH-04, ARCH-06, ARCH-10, ARCH-18, ARCH-22, ARCH-24 | Partial guard-code enum; writable reactions/global phase boolean; runner-only input stripping; lifetime author cache; eager Board resolution; releasing late claims without handling skipped plugins/partial registration. |
| Deferred convenience only | ARCH-13, ARCH-20, ARCH-26, ARCH-28, ARCH-33 | New central input dispatcher; public timestamp API; general shell confirmation service; unmeasured startup optimization; standalone return-type cleanup. Bounded checks/reload export remain useful. |
| Withdrawn defect claim; keep current abstraction | ARCH-22, ARCH-31, ARCH-32, ARCH-34 | Appropriate lazy Board-resolution split, explicit CLI adapter, fixture-backed capabilities, and generic service dispatch are not defects. ARCH-32's missing CLI wiring tests survive under ARCH-16. |
| Superseded alternative | ARCH-24, ARCH-38, ARCH-41 | Delaying complete registration staging, rejecting valid new/renumbered owner scopes, or accepting only documented partial commits conflicts with the selected supervisor plan. |
| Rejected historical certainty | ARCH-29 | Concurrent build as a proven cause of the original failures; only shared output paths and the failure/pass sequence are confirmed. |

Any normalization of Comments operation verbs must deliberately supersede ADR-0018's retained-name decision and update hooks/docs/tests together. ARCH-02 does not require renaming `comments.add` merely to match a preferred CRUD vocabulary. During conflict checking, the supervisor updated WP04/WP08 to preserve current verbs by default and corrected README line 73 to describe concurrent rebuilds as a plausible, unproven cause of the historical failures. Those corrections are resolved; there is no remaining substantive disagreement with the selected plan. The core-service editor for ARCH-43 still needs explicit assignment across WP04/WP05 before execution.

## Ranked top ten before release

1. **ARCH-36:** distinguish absent bags from invalid bags during mutations; stop silent replacement of stored Comments/links.
2. **ARCH-37:** preserve newly written Local State bags and synchronize final context consistently.
3. **ARCH-39 + ARCH-06:** make guards read-only and enforce the single-operation/phase contract, including doctor fixes, retained writer handles, and reactions.
4. **ARCH-38 + ARCH-41:** resolve logical file scopes and implement the supervisor-selected coordinated, prevalidated, recoverable commit engine under WP02.
5. **ARCH-14 + ARCH-42:** publish truthful input/result types and return final transformed values.
6. **ARCH-04:** give expected plugin user errors their normal exit codes and useful hints.
7. **ARCH-05 + ARCH-08:** remove cross-plugin context access and prevent generic bag writes from losing root enablement.
8. **ARCH-43:** make a form's edit-and-Stage-change one operation, or explicitly narrow the user-action guarantee.
9. **ARCH-09 + ARCH-40:** retain actual doctor attribution and stable UI identities; validate declarations beyond cross-plugin prefixes.
10. **ARCH-15 + ARCH-16:** correct current documentation and prevent option-contract/wiring drift. Document built-in format ownership under ARCH-27; reserve formal external compatibility machinery for P3.

ARCH-02's naming inventory, ARCH-15's documentation repair, and ARCH-16's wiring tests should accompany those contracts. Core-screen navigation (ARCH-07), pending Epic guard reads (ARCH-30), LocalState doctor data (ARCH-21), and return-only reload support (ARCH-26) are bounded useful improvements. The optional items are not prerequisites for releasing the built-ins.

## Keep as-is

- **The central service pipeline and its order:** replacement/core → transforms → guards → save → reactions. Shared hooks cover CLI/TUI and indirect Story changes. Keep replacement `core()` error passthrough (`src/services/plugins/runtime.ts:85`) and reaction warnings/background execution; add the phase/read-only/result guarantees identified above.
- **Record-level Change Sets:** Tasks remain inside Stories and Assignees inside root config. Keep before/after changes, registry ordering, and whole-Story-folder renumbering. Add the selected transaction implementation beneath this model rather than replacing it.
- **The existing file/bag layout and keys:** `plugins/<id>/` at root/Board/Story scope; `plugins.epics.epic`, `plugins.specs.specs`, and `plugins.comments.comments`. No evidence warrants a new envelope, global relational index, or renaming these formats.
- **Opaque preservation of unknown/disabled bags**, established by `test/plugins/bags.test.ts:50`; extend the missing LocalState scenario rather than removing that guarantee. Keep explicit bag removal and other-plugin entries intact.
- **Data Root enablement and Board settings cascade:** `enabled` is root-owned, objects merge, arrays replace. Keep raw settings for preservation and parsed settings/defaults for plugin behavior. Manual settings editing is acceptable when documented.
- **Static built-in registry and lazy TUI imports:** entry-point-only registry reading (`src/cli.ts:1`, `src/plugins/index.ts:8`), no direct plugin domain imports in core, and plugin-only API imports enforced by architecture tests. Third-party packaging/dependencies remain out of scope.
- **Load-time failure isolation/status reporting:** failing settings/start/CLI/TUI-load code is skipped, unknown enabled IDs reported, data retained; doctor distinguishes failed, invalid, and unchecked data. Do not promise that the same mechanism catches arbitrary component-render failures—it currently covers loading.
- **Bounded surface expansion:** own command groups, declared core options, Story fields/filters, detail tabs/rows, Board sections, and target-based Actions. Keep lists/card-column extension points closed until a consumer needs them (`docs/PLUGINS.md:89`).
- **The Action target model and core ownership of routes/focus:** plugins name targets rather than core screen names; footer/help/header presentation shares the declaration. Add safe reverse navigation capabilities without exposing raw router internals.
- **Fixture plugins and end-to-end built CLI/TUI coverage.** Replacement/start/settings slots are worth retaining despite limited built-in use. The supervisor's single combined check pass is the right way to validate parallel execution here.
- **Injected clock and ID generation, small plugin-local helpers, exported reusable TUI components, and explicit `cli.run` adapters.** Avoid making convenience abstractions public merely to eliminate a few repeated lines.
