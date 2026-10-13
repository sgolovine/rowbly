# Rowbly plugin architecture review and execution plan

Reviewed 2026-10-13 against commit `5b3acd475968ad5577bdb0a2008f7f46be3639de`. This is a review and implementation brief; application source is unchanged. Five separate T3 review threads covered architecture, code quality, plugin author experience, resilience, and other concerns. Their final validation used GPT 6.1 Sol with xhigh reasoning.

## Assessment

Keep the basic architecture: a small core, built-in plugins behind a public API, one service operation pipeline for CLI and TUI, namespaced data, and plugin files beside their owners. These are good foundations. A rewrite into a generic event bus, dependency injection framework, or database is not justified by the evidence.

The current implementation is **not ready for release with a rock-solid data integrity claim**. A Change Set is an in-memory batch, not a storage transaction. Concurrent operations can overwrite one another. Plugins receive live mutable internal changes and broad mutating services. A plugin can accidentally bypass guards, redirect a deletion, or corrupt a save. Doctor can apply a fix to the wrong Story after renumbering. Unchanged TUI plugin fields can erase invalid data. Local State changes can overwrite newer plugin bags through a stale context, and adding a Comment can replace an invalid thread. These are concrete correctness problems, not style preferences.

The code is generally compact and understandable. Its main quality problems are implicit contracts and repeated integration glue, rather than excessive abstraction. Improve those contracts first. Naming and helper extraction should follow the corrected behavior; doing a wide cleanup first creates conflicts and can preserve the wrong semantics.

For future plugin authors, the low-level API is approachable for experienced TypeScript developers but makes a simple field plugin learn too many conventions. Public packaging, compatibility, examples, and a testing harness are missing by design today. Prepare them before opening third-party creation. Their absence does not itself block a release containing only built-in plugins.

## How to use this report

This document is the consolidated decision and work plan. The five detailed reports retain the smallest findings, source locations, suggested implementations, and acceptance criteria:

| Area | Detailed report | Finding family |
| --- | --- | --- |
| General architecture | [general-architecture.md](general-architecture.md) | ARCH |
| Code quality | [code-quality.md](code-quality.md) | CQ |
| Author experience | [straightforwardness-for-plugin-authors.md](straightforwardness-for-plugin-authors.md) | DX |
| Resilience | [resiliency.md](resiliency.md) | RES |
| Other areas | [other-areas.md](other-areas.md) | PERF, BUILD, TEST, UI, DOC, OBS, VER, SEC, GIT, DEP |

Read a work package below, then its referenced findings. Use [finding-index.md](finding-index.md) to locate every finding and its execution owner. Findings overlap intentionally because each reviewer examined a different concern; overlapping findings represent one change, not several competing implementations. The work packages and decisions in this document take precedence over alternative designs suggested in a detailed report.

Evidence labels distinguish reproduced behavior, code-supported risks, and design suggestions. Reviewer severity describes impact within that area. **Execution priority here is authoritative:** an authoring convenience called “critical” is not equivalent to reproduced data loss. Optional proposals are not required features.

Line references are for the reviewed commit. Agents must inspect the current source before editing. Do not implement a recommendation merely because it has an ID; verify its trigger and keep the solution proportional.

## Independent verification

The supervisor ran `pnpm typecheck`, `pnpm lint`, and `pnpm test`: all passed, with 66 test files and 610 tests. It independently reran three reviewer reproductions:

| Reproduction | Observed result |
| --- | --- |
| Concurrent creates from independent service instances | Both returned `WEB-1`; only `WEB-1 From B` remained |
| Duplicate-key doctor repair with different Epic links | Renumbering the duplicate also removed the keeper's valid Epic link |
| Unrelated form edit with invalid Epic and Specs bags | Default plugin form input removed both bags; doctor then reported no issue |

The resilience reviewer additionally reproduced partial commits, truncated text writes, folder move failure, nested mutation loss, mutable deletion targets, orphan file adoption, and other failures. See its report for exact scope and limitations and the [archived reproduction scripts](repros/README.md). Passing the current suite demonstrates normal-path behavior; it does not prove failure recovery or concurrent safety.

## Decisions to settle before parallel implementation

1. **One mutation coordinator per Data Root.** Acquire cross-process coordination before reading state used by an operation, and hold it through final validation and commit. Include core mutations, plugin operations, doctor, and configuration changes. Canonicalize the root so aliases do not create independent locks. A save-only mutex cannot prevent duplicate key allocation.
2. **Recoverable filesystem transactions.** Preserve file-backed JSON and Markdown storage. Stage and validate the full final plan before touching live data. Use a durable manifest/journal for writes, deletions, and moves, with idempotent startup recovery. Specify the exact visibility and durability guarantee. Readers participating in Rowbly must not observe a half-committed operation. External editors and Git are outside the lock protocol and require conflict detection/documentation. In-memory rollback alone is insufficient.
3. **Private immutable identity, controlled mutation.** Plugins see detached immutable snapshots. Transform code changes data only through validated Change Set methods. Guards and reactions have read-only views. Retained handles cannot mutate after their stage finishes. Keep original storage identities private so changing record keys cannot redirect a deletion.
4. **No nested data mutation from hooks.** Enforce the rule at runtime using an async execution context and expose narrower hook contexts in types. Permit reads and the replacement's supported `core()` path; reject nested mutating services and plugin operations before any save. Commands and screens may initiate normal operations. Implement this before adding a non-reentrant lock.
5. **Logical file scopes.** Store plugin ID, relative filename, and owner identity in pending changes; resolve final paths at commit preparation. Distinguish absent pending state from deletion. Define conflicts between owner deletion and descendant writes explicitly. New owners and renumbered owners must work consistently.
6. **Preserve opaque data.** Missing, invalid, and unsupported future bags are different states. An unrelated edit must preserve raw invalid and unknown data. A clearing action must be explicit and dirty. Do not silently use a schema parse failure as “empty.”
7. **Expected errors retain their meaning.** Plugin-attributed user validation, missing records, and guard rejection retain their appropriate error codes. Unexpected exceptions become PluginErrors. Attach plugin ID, operation, stage, and cause consistently without treating every user typo as a broken plugin.
8. **Built-ins are trusted code; third-party code needs an explicit trust model.** Architectural import tests enforce conventions, not a sandbox. Do not promise malicious-code containment from capabilities or timeouts. A trusted in-process loader can be a deliberate future policy; restricted untrusted execution requires a separate design.
9. **Avoid expanding the API while fixing integrity.** Start with typed input validation, operation results, dirty forms, and shared CLI parsing. A declarative Story-field DSL is optional after those primitives stabilize. Do not build a second workflow engine.

The storage owner should write a short ADR for decisions 1–5 before code lands. The API owner should document 6–9 and publish the agreed type signatures. These are implementation decisions within this report's scope; they do not require pausing the work to ask the user about routine choices.

## Priorities and release gates

| Priority | Meaning | Required work |
| --- | --- | --- |
| P0 | Data integrity release blocker | Reentrancy enforcement; immutable stage-specific Change Sets; full-plan validation; cross-process coordination; recoverable commits and moves; doctor identity safety; invalid-bag preservation |
| P1 | Reliability and usable built-in release | Plugin UI and callback failure containment; bounded cooperative lifecycle; deterministic registration; error attribution; orphan diagnostics; corrupt Epic diagnostics; cache correctness; deletion parity |
| P2 | Authoring and maintainability improvements | Typed plugin inputs and results; smaller contexts; clean separation of surface contracts; consistent built-in organization; documentation; test harness; measured performance improvements |
| P3 | Before opening third-party loading | Published package exports; API compatibility; data version policy; trusted-loader policy; containment threat model; external author smoke test |
| Optional | Evidence or demand required | Declarative field DSL, scaffold, generalized UI helpers, dependency graph, Git capabilities, broad tracing UI |

P0 and P1 changes need failure-path tests. Do not declare transactions complete after only testing normal saves. Third-party readiness is a separate milestone from shipping built-ins. Define the supported launch data-size envelope: the historical Epic-list loading expression took about 21 seconds for 45 open Epics and roughly 5,000 Stories, excluding rendering. If roots of that size are supported, PERF-01 is a release gate rather than ordinary P2 polish. The other-areas report records measurement limitations.

## Parallel execution rules

- Use one isolated branch and linked worktree per package. Tests currently rebuild shared `dist/` and `.test-dist/`; separate checkouts avoid sharing those build artifacts. An earlier review run failed while several suites ran, but shared rebuilds were only a plausible cause, not a proven diagnosis.
- Assign one owner to each shared framework file. Agents consuming a pending API change should use its contract or wait for its prerequisite commit, not independently edit `types.ts`, `runtime.ts`, or `changeSet.ts`.
- Each package should land as a coherent change with its focused regression tests and an updated finding status. Avoid repository-wide formatting or renames in a correctness PR.
- Preserve unknown/disabled plugin data in every regression fixture. Add multiple-plugin fixtures where order or isolation matters.
- Run the repository-required checks before finishing each implementation package. The final integration owner runs them once against the combined branch and verifies the release gates.

### Ownership map

| Package | Primary ownership | Shared files requiring coordination |
| --- | --- | --- |
| WP01 Execution safety | `runtime.ts`, stage contracts, reentrancy | `types.ts` with WP04; `changeSet.ts` with WP02 |
| WP02 Storage integrity | `changeSet.ts`, `src/storage/`, transaction recovery | `runtime.ts` lock boundary with WP01; doctor with WP03 |
| WP03 Doctor correctness | `src/services/doctor.ts`, doctor identity tests | built-in doctor checks with WP08; transaction API with WP02 |
| WP04 API and inputs | public contracts and `plugin-api/`, shared CLI input parsing | `types.ts` owner; CLI attachment with WP06; form contracts with WP05 |
| WP05 TUI preservation and containment | plugin slots, form collection, Story form/filter integration; Story/Task service update logic for ARCH-43 | shared form components; patch types with WP04; operation-state read audit with WP02; built-in TUI adapters with WP08 |
| WP06 Host and CLI registration | `host.ts`, plugin CLI attachment, `main.ts` | runtime diagnostics with WP01; API contracts with WP04 |
| WP07 Tests and performance | test infrastructure, benchmarks, read budgets | built-in performance fixes with WP08; indexed Change Set with WP02 |
| WP08 Built-in plugins | Epics, Specs, Comments service/UI correctness and polish | coordinate each plugin's doctor hook with WP03 |
| WP09 Docs and observability | current architecture docs, author guide, trace specification | implementation owners provide final behavior |
| WP10 External author readiness | package exports, compatibility, loader/trust design | begins after WP04; no premature loader changes |

WP04 is the editor of shared type definitions. Other owners provide requested signatures in a small contract patch or coordinate a handoff; there should never be several simultaneous incompatible type rewrites.

## Work packages

### <a id="wp01"></a>WP01 — Enforce pipeline and hook safety

**Priority:** P0; lifecycle and diagnostic follow-ups P1. **Dependencies:** agree contracts with WP04; reentrancy enforcement precedes WP02 lock integration.

**Sources:** RES-05, RES-06, RES-15, RES-16, RES-18; ARCH-04, ARCH-05, ARCH-06, ARCH-23, ARCH-37, ARCH-39, ARCH-42; DX-17, DX-18, DX-19; CQ-33 through CQ-39.

**Deliverables:** Track active operation and stage using async context. Reject a nested mutation before its operation body runs. Build read-only hook service capabilities. Guards and reactions receive immutable Change Set snapshots; transforms receive mutation methods with a lifetime tied to their stage. Audit input/result aliases too: one callback should not be able to alter the submitted input observed by another callback. Pin the active plugin set for each operation rather than iterating a live host array during reload/failure. Seal the complete Change Set before commit. Refresh context from final committed Local State before reactions, preserving inferred Me identity unless the stored selection actually changes. Preserve replacement `core()` error semantics and establish whether repeated calls are rejected; do not accidentally invoke the body twice.

Use one invocation/error adapter for host-controlled callbacks. Preserve expected Rowbly error codes while attaching plugin attribution; wrap unexpected errors. Background reactions need tracked lifetime, warning delivery, teardown, and an ordering policy. Bound returned asynchronous handlers cooperatively and revoke mutation handles when a timeout occurs. Promise timeouts cannot interrupt synchronous loops or arbitrary detached code; document that limitation rather than claiming full isolation. Do not hold the mutation lock while waiting for post-commit external reactions.

**Acceptance:** A transform calling a mutating service saves nothing and returns an attributed error. Recursion terminates immediately. Mutation of a snapshot cannot redirect deletion or alter another plugin's view. A retained transform handle used in a guard/reaction/late continuation cannot change pending data. Replacement `core()` works once with preserved core errors. A never-settling reaction cannot indefinitely block a command; later operations and shutdown have defined behavior. Reaction failure leaves a successful committed operation successful.

**Parallel boundary:** WP02 owns commit preparation and private source identities. WP01 provides stage sealing and lock entry/exit hooks; do not introduce a separate competing transaction layer.

### <a id="wp02"></a>WP02 — Make storage commits recoverable and concurrent operations safe

**Priority:** P0. **Dependencies:** WP01 nested-mutation rejection; contract ADR before implementation.

**Sources:** RES-01 through RES-04, RES-06 through RES-08, RES-10, RES-19, RES-21, RES-24; ARCH-37, ARCH-38, ARCH-41; PERF-03, PERF-04; SEC-02; CQ-40 through CQ-45.

**Deliverables:** Coordinate whole operations across processes, before state reads. Specify lock acquisition timeout, stale-lock recovery, canonical root identity, and release on every failure. Audit reads before `ops.run` and stale in-memory context: acquiring a lock is insufficient if the body then copies `ctx.local` rather than current stored Local State. Apply patches to freshly read records and refresh context from the final committed result. Validate all final records, source/destination identities, path containment, and conflicting file plans before mutation. Stage text and JSON safely, journal operations and original state, and recover process death during each commit phase. Prevent a handled move error from leaving hidden `.moving` folders. Never adopt plugin-bearing orphan folders when allocating Story keys. Refresh or invalidate prefix indexes across operations and external changes according to an explicit policy.

Store logical file ownership until commit. Resolve paths using final owner state, including pending Board creation, Story movement/renumbering, and deletion. Reject contradictory writes to deleted scopes. Parent deletion must not be followed by child recreation. Protect filesystem boundaries against symlink escape to the extent claimed by the capability contract; distinguish this from malicious plugin sandboxing.

**Acceptance:** Failure injection at every write/move/delete/manifest step yields the complete old or complete new state after recovery. Kill a subprocess after staging and mid-commit; reopen and recover idempotently. Two processes creating Stories return different keys and preserve both records. Concurrent updates use a documented serialization/conflict policy and never silently lose an accepted change. A plugin Local State update followed by `use`, `clearUse`, or `setMe` preserves the new bag, including across service instances. Read errors and write errors do not truncate the old text file. Renumbering moves queued and existing plugin files together. Occupied orphan folders reserve keys. Cross-process Board changes invalidate Story lookup caches. Repeated recovery is safe.

**Scope guard:** Do not replace file storage with SQLite as a shortcut; that changes the product's data model. Do not claim global atomic visibility to external filesystem readers. Define Rowbly's participating-reader protocol and crash-durability assumptions explicitly.

### <a id="wp03"></a>WP03 — Make doctor fixes identity-safe and complete

**Priority:** P0 identity repair; P1 diagnostics. **Dependencies:** transaction API from WP02; immutable views from WP01.

**Sources:** RES-04, RES-07, RES-09, RES-12, RES-17; ARCH-09, ARCH-21, ARCH-27; DX-29; VER-02, VER-03; relevant doctor CQ findings.

**Deliverables:** Separate structural core repair from plugin finding generation. After identity-changing repairs commit, rescan before creating plugin fix closures. Keep stable source identity/path where keys can be duplicated; never resolve ambiguous fixes by current key alone. Persist explicit plugin IDs on internal findings and error wrappers rather than reconstructing IDs from uppercase code prefixes. Add Local State to plugin doctor data if its declared bag support needs it. Report interrupted transactions, orphan plugin-bearing folders, corrupt plugin files, unsupported versions, and legacy Comments storage.

**Acceptance:** The duplicate WEB-1 fixture preserves the keeper's valid Epic link and fixes only the renumbered duplicate. Guards veto a repair before disk changes. Failure in one pass is transactionally recoverable. Hyphenated plugin IDs retain exact attribution. Doctor distinguishes unchecked inactive data from validated healthy data. Corrupt and future-version files are reported without destructive automatic rewriting. The run converges or reports a bounded unresolved state rather than looping silently.

**Parallel boundary:** WP08 owns Epic-specific parse/check logic. WP03 owns when those checks and fixes run and how findings carry identity.

### <a id="wp04"></a>WP04 — Stabilize the public API and shared input contracts

**Priority:** P0 stage/read contracts needed by WP01/WP05; remainder P2. **Dependencies:** agree semantics first, then publish signatures for consumers.

**Sources:** ARCH-01 through ARCH-05, ARCH-08, ARCH-10 through ARCH-12, ARCH-14, ARCH-16 through ARCH-22, ARCH-31, ARCH-32, ARCH-36, ARCH-42; DX-06 through DX-12, DX-17 through DX-24, DX-30, DX-33 through DX-35; CQ-01 through CQ-03, CQ-07, CQ-13, CQ-18, CQ-21 through CQ-27, CQ-50 through CQ-54, CQ-165.

**Deliverables:** Keep operation/data contracts distinct from CLI/TUI contracts so the operation runner need not understand React or commander. A module split is optional organizational work: type-only React/commander imports do not themselves prove a runtime dependency. Export only the intentional public capabilities. Put editor interaction in CLI command context. Add typed, schema-validated plugin operation input/filter boundaries where useful; retain an escape hatch for advanced mappings. Permit per-operation payload schemas: Comments add/update/remove and Story input need different shapes, so one plugin-wide payload schema is insufficient. Preserve the existing working settings inference and add compile-only author fixtures; the initial claim that settings never infer was withdrawn after compiler probes.

Expose the core result (or a narrowly typed created-record helper) to transforms so they do not scan for “first newly created Story.” Define whether the result reflects prior transforms and recompute final returned entities after transforms. Centralize absent/clear/value semantics across CLI and TUI, negation pairing, repeatable parsing, and expected validation errors. Comma splitting must be opt-in: a repeatable text flag may legitimately contain commas. Add JSON file helpers only if they preserve transaction-aware reads and data-integrity errors. Keep settings separate from general bags so a write cannot accidentally drop `enabled`. Repair `writeBag`'s return type: it cannot promise an arbitrary input subtype with required bag fields after changing/removing those fields (CQ-165).

Publish one operation-name/input/result inventory and validate local name syntax without creating a global event registry for all hypothetical plugins. Keep current published verbs by default, including ADR-approved Comments names; a uniform renaming is optional and must be one deliberate decision. Type known operation inputs/results precisely, including fields and enable/disable. Audit the actual values seen by reactions, not only service return signatures: `fields.update` currently delivers an internal `{ next, stripped }` object to reactions while callers receive the public array. Decide whether replacements remain an advanced supported capability; keep them out of the beginner guide and test their contract.

**Acceptance:** A sample plugin compiles without casts for settings or input; invalid input rejects before any write with the correct attributed error. No-input does nothing, explicit null clears, and an actual value sets, consistently across both surfaces. Repeatable values and negative flags normalize predictably. Settings writes preserve activation. A create hook targets the actual created entity even when another plugin also adds records. CLI-only code imports no Ink/React runtime. Compile fixtures prevent public type regressions.

**Scope guard:** The declarative `storyFields` proposal (DX-01) is an optional follow-up. First prove that these smaller fixes remove enough glue. Do not automatically add typed screen registries, operation declaration DSLs, or helper families solely to remove a few lines.

### <a id="wp05"></a>WP05 — Preserve plugin data and isolate TUI failures

**Priority:** P0 data preservation; P1 containment. **Dependencies:** bag state and form contracts from WP04; WP01 callback policy.

**Sources:** RES-11 through RES-13, RES-18, RES-20, RES-23; DX-09, DX-20, DX-24 through DX-28, DX-31; ARCH-07, ARCH-13, ARCH-25, ARCH-26, ARCH-40, ARCH-43; CQ-55 through CQ-62 and TUI built-in findings.

**Deliverables:** Track dirty plugin fields and submit input only for plugins whose fields changed. Distinguish invalid from absent data; provide an explicit reset/repair path. Isolate field loading per plugin and exclude failed plugins from input gathering. Place plugin-specific render boundaries around slots and plugin screens that handle ordinary exceptions, identify the plugin, and allow core navigation and other slots to continue. Async callbacks need separate invocation handling because React boundaries do not catch them.

Make Story/Task form submissions that edit fields and change Stage one service operation; the current update-then-move sequence can save the edit before a move guard rejects. Coordinate with WP04 on patch types, Stage validation, rank allocation, hook intent, and final results. Do not solve this by nesting a public move operation. Add narrowly typed navigation to core screens used by built-ins. Check action keys against actual active bindings rather than relying solely on a manually maintained reservation string. Home routes and settings/tab identities must use stable internal values rather than display labels (ARCH-40). Validate incoming screen params at boundaries where invalid params currently create empty IDs. Improve loading/error labels so an error is not shown as “No Comments.” Extract confirmation/reload/key helpers only when their actual shared behavior is clear.

**Acceptance:** Edit only a Story name while invalid/future Epic/Specs bags exist; raw bag values remain semantically identical, including unknown keys, and doctor still sees their issue. JSON whitespace/key order is not a preservation guarantee. Unchanged valid bags remain untouched. Explicit clear works. A rejecting Stage-transition guard prevents every part of a combined form edit from saving; successful submission commits/reacts once and preserves the correct destination rank. One corrupt Epic does not prevent editing core fields or loading another plugin's fields. An omitted field provider never sends clearing input. A throwing plugin component renders a localized failure and esc/core navigation works. Event and async failures are attributed without crashing the TUI. Disabled/reloaded plugins do not leave stale actions, fields, or context. Two same-label Home entries navigate to their distinct destinations. Both loader and no-loader activation paths use the intended reaction/warning policy, and reload does not repeat a once-per-run warning unnecessarily.

**Organization:** Every new React component uses its own PascalCase file and folder barrel, per AGENTS.md. Keep app.tsx thin. Route shared hooks through area barrels.

**Core-service ownership:** WP05 owns the combined-edit implementation in `src/services/stories.ts` and `src/services/tasks.ts` for ARCH-43. WP04 owns its public patch/event types. WP02 must finish or hand off any operation-read/locking audit touching those files before WP05 edits them; do not race the Stage/rank patch with the storage integration.

### <a id="wp06"></a>WP06 — Make host loading and CLI registration deterministic

**Priority:** P1. **Dependencies:** WP04 contract shape; diagnostics from WP01.

**Sources:** RES-14, RES-16, RES-18, RES-22, RES-25; ARCH-13, ARCH-24, ARCH-28, ARCH-34, ARCH-35, ARCH-40; DX-10, DX-13, DX-32; OBS-02, OBS-03; PERF-05, PERF-06; CQ-28 through CQ-32, CQ-46 through CQ-49, CQ-63 onward where CLI-specific.

**Deliverables:** Validate definitions and duplicate IDs/flags/actions before activation. Allow legitimate positive/negative option pairs while rejecting duplicate raw flags and ambiguous attributes. Register a plugin's complete contributions as one staged unit so a late failure does not leave partial commands/options or ghost claims. A failed plugin should not prevent unrelated plugins loading. Report missing core command attachment paths instead of silently skipping. Return snapshots from host status/active/failure APIs. Make plugin status distinguish activation failure, TUI failure, and unavailable definitions accurately.

Handle module evaluation failure deliberately. Static built-in imports occur before host startup; do not claim the host catches them. Choose a small lazy descriptor boundary if built-in recovery is required, and test that disable/status remains usable after failure. Skip unnecessary startup work for version and initialization commands when their behavior permits it. Surface effective settings and failure reasons without leaking secrets in diagnostics.

**Acceptance:** Duplicate options inside one plugin fail that plugin at load; core commands still construct and run. Positive/negative pairs work. A failed command callback registration leaves no command, option, action, or permanent name claim. Duplicate IDs are rejected deterministically. Later healthy plugins activate consistently. A failed TUI provider has a documented effect on service hooks. `plugins disable` remains a viable recovery path. Context cache/reload cannot return settings from a prior activation.

### <a id="wp07"></a>WP07 — Improve test infrastructure and measured performance

**Priority:** P1 failure tests; P2 performance and author harness. **Dependencies:** begin independent infrastructure work now; add package tests as APIs land.

**Sources:** ARCH-29; PERF-01 through PERF-07; TEST-01 through TEST-04; DX-15; CQ-136 through CQ-157.

**Deliverables:** Make CLI build artifacts unique per test run or coordinate the build; avoid concurrent `clean` deleting another run's executable. Share plugin TUI setup with warning behavior matching production. Replace timing sleeps with observable completion. Navigate forms by meaning where feasible instead of centralizing magic tab counts that still break on field insertion. Provide a small public test harness after the API/package boundary is real; reuse it internally so it remains tested.

Measure Epic list and Specs doctor filesystem reads and wall-clock behavior on representative roots. Compute Epic progress from one shared Story/config snapshot rather than per Epic. Deduplicate Spec existence checks per scope. Add indexed Change Set lookup only while preserving ordered snapshots and immutable identities; WP02 owns that implementation. Use operation-scoped caching, not stale process-wide memoization. Benchmark invocation cold-start separately from warm operations.

**Acceptance:** Two test runs in separate processes cannot delete each other's CLI bundles. A filtered unit test avoids unnecessary CLI builds where feasible. Epics and Specs results match current semantics while read counts scale with records/files rather than repeated cross-products. Multiple plugins/disabled plugins remain covered. Benchmark outputs state fixture size, machine, cache state, and variance; no fragile universal millisecond threshold. A plugin author can test a guard, command, and form without private repository imports once WP10 exports are available.

### <a id="wp08"></a>WP08 — Harden and simplify the built-in plugins

**Priority:** P0 for invalid Comment-thread preservation; P1 remaining correctness; P2 readability; optional nits can follow. **Dependencies:** WP04 contracts and WP02 transaction reads; can draft plugin-specific tests independently.

**Sources:** RES-12; ARCH-18, ARCH-30, ARCH-36, ARCH-42; UI-01, UI-02; VER-03; PERF-01, PERF-02, PERF-04, PERF-08, PERF-09; CQ built-in sections, especially operation naming, metadata timestamps, error states, parameter validation, and duplicated flows; DX repeated-pattern table.

**Deliverables:** Epic doctor parses every owned JSON file, reports corrupt/schema/future-version/ID-path errors, and preserves originals. Epic guards consult transaction-aware pending files when the operation changes them. Specs checks and bulk edits reuse loaded records and deduplicate reads. Missing linked Spec choices must remain visible and removable in forms rather than being selected invisibly outside the available choices. Board removal through TUI offers the same force semantics as CLI when Specs are the blocker. Comments gets targeted legacy-storage diagnostics and one consistent current-author resolution.

Reject mutation of invalid or unsupported Comment threads and Specs link bags until the user chooses an explicit repair/migration; tolerant reads returning empty data must not authorize overwriting a malformed bag. Choose one ordinary plugin layout (`index`, model/schema, service, commands, TUI entry, components) and apply it only where it improves navigation. Follow WP04's operation inventory and truthful result contracts; verb/layout uniformity is optional cleanup. Keep plugin-specific helpers local; avoid cross-plugin internal imports. Correct misleading error/empty-state labels, timestamps, params, sentinel handling, and duplicated deletion flows. Address every accepted small CQ finding through this package's checklist, but leave explicit deferred findings unchanged.

**Acceptance:** Corrupt Epic fixtures do not erase links and doctor reports the specific file. Newly queued Epic/Spec file changes are visible to guards. Force Board deletion removes its Specs and Stories via the guarded transaction. Comment owner/author behavior matches core rules. CLI JSON results and TUI navigation are covered after naming/layout changes. All TUI organization rules hold. Valid disabled and unknown bags survive.

**Parallelism:** Once framework contracts land, separate agents may own Epics, Specs, and Comments in distinct worktrees. They must not each introduce competing public parsing/UI helpers; WP04/WP05 own those helpers.

### <a id="wp09"></a>WP09 — Correct documentation and add focused diagnostics

**Priority:** P2; trust/error documentation accompanies P1 changes. **Dependencies:** behavioral contracts from WP01–WP06.

**Sources:** DOC-01 through DOC-05; OBS-01 through OBS-03; ARCH-15, ARCH-27; DX-03 through DX-05; CQ-158 through CQ-164.

**Deliverables:** Rewrite current architecture references that still mention SQLite, removed core Comments/Epics, old Story layout, or capabilities not implemented. Preserve ADR history with explicit superseding links and current-status notes. Publish a short runnable plugin tutorial followed by API reference, lifecycle order, order/conflict rules, absent/clear conventions, expected errors, failed-plugin behavior, transaction guarantees, and migration rules. Compile/test the tutorial example.

Add opt-in structured operation traces if they can be kept small: operation ID, plugin ID, stage, elapsed time, outcome, and root-relative affected paths. Exclude bag content, descriptions, editor text, and secrets by default. Keep diagnostic output off JSON stdout. Effective settings/status diagnostics should explain why a plugin is disabled, failed, or scoped differently without implying unimplemented Board activation semantics.

**Acceptance:** A new reader can describe the actual persistence model and write/test a minimal plugin from docs alone. All documented commands and imports work. JSON command output remains parseable with tracing enabled. A failing hook can be located by plugin/stage without private payload logging. Domain glossaries and CONTEXT-MAP agree with current built-ins.

### <a id="wp10"></a>WP10 — Prepare external plugin authors without premature infrastructure

**Priority:** P3 before third-party loading. **Dependencies:** WP04 stable API, WP07 harness, WP09 guide; storage guarantees established first.

**Sources:** DX-02, DX-14 through DX-16; BUILD-01; VER-01 through VER-03; SEC-01 through SEC-03; DEP-01; GIT-01; ARCH-27, ARCH-32.

**Deliverables:** Publish intentional package subpath exports with generated declarations for plugin, TUI, and testing APIs; verify a plugin in a separate package imports no source paths. Define API compatibility metadata separately from plugin release and data schema versions. Reject incompatible definitions before executing hooks. Preserve unsupported future bags/files and offer explicit, dry-run-capable migrations that use the transaction coordinator; do not silently rewrite data at startup.

Write an explicit external-loader trust policy before implementing discovery/install. Test namespace and symlink containment for the file API, while stating that in-process JS remains trusted. Add dependency ordering only when a real dependent plugin requires it; use missing/version/cycle validation then, not today. Add a scaffold only after the tutorial/harness contract works. Keep planned Git capabilities outside this review's required implementation; its design needs process access, ordering, and failure semantics first.

**Acceptance:** A separate fixture package builds and exercises one hook, CLI command, and lazy TUI contribution against published artifacts. Unsupported API versions fail early with an actionable reason. Older Rowbly does not overwrite future plugin data. Explicit migration is idempotent, reports planned changes, preserves backups/recovery, and survives interrupted execution. The trust policy is accurate and visible before a third-party plugin is installed.

## Suggested execution waves

| Wave | Parallel work | Exit condition |
| --- | --- | --- |
| 0 | WP01/WP02/WP04 contract ADR; WP07 failure fixtures; WP09 factual documentation corrections | Shared stage, lock, identity, bag and error contracts agreed |
| 1 | WP01 runtime safety; WP02 storage staging/transaction engine; WP05 preservation tests and dirty forms; WP06 definition validation | Reentrancy rejected; immutable views; staged final validation; unchanged bags preserved |
| 2 | WP02 lock/recovery integration; WP03 identity-safe doctor; WP05 plugin boundaries; WP06 complete registration/lifecycle | P0 failure and concurrency gates pass; P1 containment demonstrated |
| 3 | WP04 author API refinement; WP07 performance/harness; WP08 plugin-specific correctness and cleanup; WP09 guide/traces | Built-in release gates pass; all findings have dispositions |
| 4 | WP10 packaging/compatibility/trust; optional field/scaffold prototypes only if justified | External author smoke test passes before third-party launch |

WP02 is the critical path. Split staging, journaling, and recovery into reviewable commits under one owner rather than assigning several agents the same commit engine. Tests can be drafted concurrently against the agreed contract. WP03 should not ship a workaround that assumes nontransactional saves are acceptable.

## Recommendations not adopted wholesale

- A declarative Story-field API is a plausible reduction in author boilerplate, not a release blocker. Compare a minimal sample after typed input/result and form fixes before choosing it.
- A fully declared, schema-generated operation registry may help later interoperability. Standard naming, precise core types, and input validation meet today's need with less machinery.
- Generalized `<Async>`, confirmation, keymap, route, and nullable-select APIs should follow demonstrated repetition. Do not expose every internal convenience publicly.
- Removing replacements entirely is not necessary for integrity. Either maintain a tested advanced contract or deliberately deprecate it; moving it under `advanced` alone does not fix behavior.
- Silent doctor migration of unknown or future data is rejected. Diagnostics and explicit migration are safer. Existing unversioned built-in bags need a documented legacy interpretation.
- ARCH-41 permits a narrower product contract that documents partial commits. This consolidated plan chooses recoverable commits as required, based on the reproduced data-loss paths and the user's requested resilience standard.
- Expected plugin errors should keep their domain exit code and gain attribution. Blanket wrapping into INTERNAL with a disable hint is rejected.
- Source import checks and cooperative timeouts are not security isolation. A sandbox, worker/process boundary, and permission UI would be a separate product/security project if untrusted execution is required.
- Performance claims need measured fixtures. Cache only within a defined invalidation scope and do not trade correctness for a warm benchmark.
- Nits that only rename a variable, centralize a one-line expression, or remove an intentional public export may be deferred. They remain recorded so agents do not confuse omission with oversight.
- Settings-schema inference and guards with no explicit return already work in compiler probes. Do not add redundant generics or require explicit `return undefined` based on the original review claims.

## Completion checklist for the integration owner

- [ ] All P0 reproductions are permanent regressions; crash recovery and real cross-process concurrency tests pass.
- [ ] Entire final plans are validated before live writes; original identities and plugin file scopes cannot be redirected by snapshots.
- [ ] Doctor repairs the intended physical record and rescans after structural changes.
- [ ] Unchanged invalid/unknown/future bags survive core edits and failed plugin field loading.
- [ ] A plugin load, render, callback, or reaction failure has the documented containment and error semantics.
- [ ] Built-in CLI/TUI operations, including forced Board deletion, remain equivalent.
- [ ] Each accepted finding in the index is resolved or has a recorded deferral with rationale; overlapping IDs point to one change.
- [ ] Documentation and public compile fixtures describe final contracts, not the reviewed baseline.
- [ ] `pnpm typecheck`, `pnpm lint`, and `pnpm test` pass on the integrated branch.
- [ ] Third-party launch, if included, passes the separate published-package compatibility and trust gates.

The goal is to retain Rowbly's straightforward file-backed plugin model while making its boundaries enforceable. The smallest safe implementation is one well-defined mutation pipeline and commit engine, explicit data-preservation semantics, and a restrained public API built on those guarantees.
