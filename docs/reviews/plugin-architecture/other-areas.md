# Plugin architecture review: other areas

Reviewed on 2026-10-13 against `5b3acd475968ad5577bdb0a2008f7f46be3639de`.

This report covers performance, testing infrastructure, documentation, observability, CLI/TUI consistency, compatibility, migration, packaging, capability safety, the Git design, and future dependencies. It preserves all 29 finding IDs from the previous report and adds three smaller findings: PERF-08, PERF-09, and UI-02. Findings overlapping architecture, code quality, author experience, or resiliency are explicitly assigned shared ownership below.

The current pass changed only this report. It did not modify source, run `pnpm test`, rebuild the CLI, or rerun the benchmarks. The baseline and measurements below are historical evidence from the preceding review at the same HEAD, cross-checked against current source and surviving logs/scripts. The supervisor owns final checks.

The supervisor's [README.md](README.md) was read for conflict checking only. Its decisions, WP ownership and execution priorities take precedence over alternatives here. This detailed report's local severity/release observations do not supersede its P0/P1 gates. No original finding is deleted or renumbered; conditional/deferred portions remain explicit below.

## Conclusions and release scope

The strongest current problems are repeated whole-root loading for the TUI Epic list, repeated Spec/Board reads in doctor, quadratic pending-change lookup, and the TUI's inability to force-delete an empty Board containing Specs. There is also a present data-safety problem: mutations can treat an invalid Comments bag as an empty Thread and replace it. Fix that without waiting for a general migration framework.

Delivery classes used throughout:

- **Current release gate:** UI-01 if the documented CLI/TUI mutation-parity promise is retained; the invalid-data mutation protection in VER-02. PERF-01 should be a gate if Boards with thousands of Stories are in the supported launch envelope.
- **Conditional release gate:** VER-03 if historical core Comments/Epics data is supported; BUILD-01, VER-01, SEC-01/02 before a loader is advertised as supporting external Plugins; GIT-01 before ADR-0016 is advertised as implemented; DEP-01 before required Plugin dependencies are offered.
- **Useful improvement:** concrete performance, testing, diagnostics, and documentation changes with current consumers. These need not all block the first built-in-only release.
- **Optional abstraction:** lazy descriptor registries, public harness packaging, full API semver machinery, generic migration registration, detailed contribution manifests, untrusted-process isolation, and typed cross-Plugin operation registration. These are proposals for a real consumer, not requirements to build speculative infrastructure now.

Severity describes impact in the stated scope, not an automatic release gate. No critical finding is asserted. “Confirmed” means supported by the current implementation; it does not mean every impact was reproduced in a fresh end-to-end run. “Inferred” identifies extrapolation or a future feature's needs.

## Corrections to the prior report

| Prior statement/recommendation | Corrected assessment |
| --- | --- |
| Original handoff's large-data timings | Excluded: its Board fixture lacked required timestamps and commands failed. Only the corrected run's results below are retained. |
| Small on/off latency differences imply Plugin overhead | They do not. List/move differences are noise, and different filtered results have different serialization costs. |
| Change Set `putStory` timing isolates linear-scan CPU | It also includes schema parsing and missing-record lookups. Pending updates/lookups have no final-save cost, but are not pure lookup-only benchmarks either. |
| 21.3 seconds is a full TUI startup time | It times the Epic list's data-loading expression through `tsx`, excluding module startup, initial Epic enumeration, and rendering. |
| No way to run one Plugin in isolation | Already supported by `loadPlugins({ registry: [plugin] })` and `withPlugins(t, [plugin])`. The gap is a documented/consolidated harness and convenient CLI isolation. |
| Missing tutorial/JSDoc | There is already a substantial writing guide and member JSDoc. Complete examples and lifecycle precision are missing; replacing them wholesale would waste useful work. |
| Lack of debug tracing is a major current defect | Retained as OBS-01, downgraded to minor/useful improvement. Existing pipeline errors and list/doctor output already provide meaningful attribution. |
| Public API versioning/package exports must precede built-in release | Not necessary for definitions compiled and shipped with core. They are conditional external-loader requirements; a simple policy document is useful now. |
| All bags should immediately gain versions and a generic migration engine | First protect invalid-data writes. Choose versioning when schemas actually evolve; unknown-key handling is a compatibility policy, not universally an error. |
| “Not migrated” is an accidental regression | Explicitly accepted in ADR-0014/0018. VER-03 is a conditional compatibility decision and diagnostic gap, not a claim that current behavior violates those ADRs. |
| Sandboxing is required for today's built-ins | Built-ins are trusted repository code. External trusted code can also be explicitly full-trust. Isolation is needed only if a constrained/untrusted execution promise is made. |
| File deletion through a final symlink deletes its target | A final symlink is normally unlinked itself. Reads and direct text writes follow final symlinks; containing-directory symlinks can redirect reads/writes/deletions. No exploit was executed in this pass. |
| Git requires a general process/filesystem capability | Use narrow host-owned Git and hook-install operations when Git is implemented. Do not expose arbitrary shell/filesystem access just for this ADR. |
| Dependencies require typed operation registration now | Required/optional loading policy is needed only when dependencies ship. Ordinary string hook names can remain until a concrete typed interoperability consumer exists. |

## Historical evidence and limits

The preceding corrected fixture contained one Board, initially 5,000 Stories, one Task per Story, 50 Epics (45 open), 21 Board Specs, two Story Comments and one Task Comment per Story. Every Story linked two Board Specs. Doctor returned an empty finding list before mutation benchmarks.

CLI durations are best-of-three wall-clock runs, stdout discarded, command exit codes checked. The creation benchmark subsequently added three Stories. The move benchmark repeats the same move; those samples should not be used as three independent equivalent writes. Benchmarks overlapped some other review activity; results lack distributions, filesystem/cold-cache control, and CPU specifications. The current environment reports Node `v24.21.0`; the original logs did not record the version at measurement time. These are illustrative local observations, not CI budgets or proof of behavior on the minimum supported Node 22.

| Workload | Plugins off | Plugins on | Interpretation |
| --- | ---: | ---: | --- |
| `stories list --json` | 857 ms | 825 ms | No demonstrated Plugin penalty. |
| Epic-filtered Story list | — | 769 ms | Still reads the Board's Stories; smaller output. |
| Spec-filtered Story list | — | 811 ms | Bag-only filtering; no Spec document read in the matcher. |
| `stories list --open --json` | 805 ms | — | Core list baseline. |
| Story show | 222 ms | 227 ms | Current built-in rows add little observable time in this sample. |
| Task show | — | 217 ms | Current Comments row parses the supplied Task bag. |
| Doctor | 1,311 ms | 3,208 ms | Extra reads corroborated independently by instrumentation. |
| Epic list, CLI | — | 237 ms | Does not calculate every Epic's progress. |
| Epic show | — | 841 ms | One whole-root Story list. |
| Specs list | — | 225 ms | 21 Spec documents in this fixture. |
| Comments list | — | 224 ms | One owner lookup. |
| Story create with Epic/Spec | — | 861 ms | Adds a new Story each run; includes allocation/ranking scans. |
| Story move | 826 ms | 820 ms | Repeated mutation; not a pure pipeline benchmark. |
| Comments add | — | 219 ms | Appends a Comment each run. |

Additional historical observations:

- Epic list loading expression for 45 open Epics, after the creation runs: **21,307.2 ms**, excluding rendering. Roughly 45 × 5,003 Story-read requests are implied by source; that count was not instrumented.
- Deleting `common.md` and unlinking exactly 5,000 Stories: **4,719 ms**, exit 0. Includes reads, parsing, change collection, and filesystem writes.
- One instrumented doctor on the initial fixture: **10,001 Board-config read attempts, 5,000 Story read attempts, 10,000 Markdown read attempts, four other reads**. The instrumentation counts `fs/promises.readFile` attempts, not bytes, cache misses, or physical disk operations.
- Microbenchmark: 5,000 `putStory` calls **694.0 ms**; updates of 5,000 pending Stories **1,781.6 ms**; 5,000 `story(key)` calls **850.0 ms**.
- Parsing 5,000 minimal bags with `z.object({ epic: z.string() })`: **16.8 ms**. This schema is simpler than the actual slug-validating Epic bag. Parsing 5,000 simple Stories without Tasks/Comments: **63.0 ms**; JSON round trip: **23.6 ms**. These are not whole-root or long-Thread validation costs.
- `reservedNames()` **6.1 ms**, subsequent `createProgram()` **1.1 ms**, enabled-Plugin activation **8.7 ms**, no enabled Plugins **0.5 ms**, all after imports. Single samples and warm-up/order effects apply.
- One empty Node process **39 ms**, one CLI `--version` **203 ms**. The difference includes all CLI imports/discovery/Commander behavior; it is not a measured Plugin-specific tax.
- Prior build: JavaScript **425,689 bytes** total, `cli.js` **81,120 bytes**, excluding source maps and installed dependencies. Plugin definitions are present in the CLI bundle; Plugin TUI chunks are dynamic. Chunk names are build artifacts, not API contracts.

Historical validation: 66 files / 610 tests passed in 26.55 seconds; typecheck and lint passed. This is not a claim that checks were rerun after this report was written.

## Performance and build findings

### <a id="perf-01"></a>PERF-01 — TUI Epic list loads all Stories once per Epic

- **Severity / status / class:** major; confirmed source and historical measurement; current scalability improvement, conditional launch gate for large roots.
- **Evidence:** `src/plugins/epics/EpicList.tsx:18`, `src/plugins/epics/service.ts:69`, `src/plugins/epics/service.ts:89`, `src/storage/repositories.ts:123`. `Promise.all(epics.map(showEpic))` independently calls `stories.list(null, {})` for every Epic. The historical loading expression took 21.3 seconds for 45 open Epics.
- **Why it matters:** O(E × S) record loading/parsing plus simultaneous I/O scheduling for a screen that needs only summary rows. `showEpic` also groups by repeatedly filtering the linked Story list for each Board; grouping in the same pass avoids that smaller O(B × L) cost.
- **Recommended change:** add `listEpicSummaries(plugin, mode)` in `src/plugins/epics/service.ts`; list Epics once, Stories once, and effective Stage configuration once per relevant Board. Accumulate per-Epic/per-Board groups and done counts in Maps. Extract a small shared progress helper used by summaries and detail; switch `EpicList` to summaries. Return only summary data for the list. No persistent cache, index file, or new repository service is needed.
- **Acceptance:** service-call spy verifies one `stories.list` regardless of Epic count; cover open/closed/all, empty Epics, multiple Boards with distinct Stage keys/categories, and Story bags belonging to disabled/unknown Plugins. Summary progress agrees with `showEpic`; the CLI list need not gain progress or extra work. Re-measure the loading expression without a flaky CI time limit.
- **Dependencies / ownership:** Epics worker owns `service.ts` and `EpicList.tsx`; coordinate with code-quality refactoring in those files. Independent of Change Set indexing. Do not introduce shared caches as a substitute for batching.

### <a id="perf-02"></a>PERF-02 — Specs doctor reads identical files once per Story link

- **Severity / status / class:** major; confirmed source and read-count evidence; useful current improvement.
- **Evidence:** `src/plugins/specs/index.ts:95`, `src/services/plugins/changeSet.ts:254`, `src/services/plugins/changeSet.ts:278`, `src/storage/repositories.ts:68`. Each of 10,000 links resolves/reloads its Board then reads its Markdown; total doctor count was 10,001 Board and 10,000 Markdown reads.
- **Why it matters:** the same 21 documents are repeatedly read while doctor already has validated Boards/Stories. Doctor time increased from 1.31 to 3.21 seconds in the fixture.
- **Recommended change:** group checked Stories by Board and resolve distinct linked slugs once per check. Minimal behavior-preserving implementation: a local Map of `(board, slug)` to the read/existence result, with one operation-local Board-scope resolution cache if needed. A per-Board filename Set avoids Markdown reads altogether if the intended check is only existence. Agree on readability/symlink semantics before replacing `read` with `list`; current `listFilesUnder` omits final symlink entries whereas `read` follows them. Content validation, if desired, is a separate check and should read each document once.
- **Acceptance:** instrument or spy reads with 5,000 Stories linking the same two files; cost depends on distinct Boards/documents rather than link count. Preserve missing-link findings/fixes, valid links, disabled-Plugin behavior, and the chosen unreadable/symlink policy. Include two Boards with the same slug to prevent cache-key collisions; cache lifetime ends at the check pass.
- **Dependencies / ownership:** Specs worker owns the check; storage/runtime worker owns any scope-cache change. Coordinate SEC-02 and resiliency semantics. Do not add a process-global file cache.

### <a id="perf-03"></a>PERF-03 — Pending Change Set searches have quadratic aggregate cost

- **Severity / status / class:** major; confirmed source, historical corroboration; useful current improvement.
- **Evidence:** `src/services/plugins/changeSet.ts:56`, `src/services/plugins/changeSet.ts:61`, `src/services/plugins/changeSet.ts:65`, `src/services/plugins/changeSet.ts:205`, `src/services/plugins/changeSet.ts:210`, `src/services/plugins/changeSet.ts:215`. `stories()` filters/allocates the entire list for each lookup; Board/file lookups also scan it. Microbenchmark pending updates took 1.78 seconds and lookups 850 ms at 5,000 entries.
- **Recommended change:** retain the ordered array for save/reaction order; add indexes for pending current Story keys, historical aliases used by `story(key)`, Board ids, and file paths. Maintain indexes through one insertion/update path, including `recordStory` and `deleteBoard`. Do not infer an index only from `after.key`: renumbering and deleted records require explicit identity rules. Resolve existing duplicate/renumber semantics with architecture before optimizing them.
- **Acceptance:** repeated updates coalesce as before; case-insensitive lookup, old/new renumber keys, deletion, creation, `recordStory`, Board deletion, and interleaved file changes retain correct before/after data and order. No full-list scan/allocation per indexed lookup. Keep benchmark results outside timing-sensitive unit tests.
- **Dependencies / ownership:** one runtime/Change Set worker owns `changeSet.ts`; combine PERF-04 in that task. Architecture/resiliency reviewers may change identity/immutability/record coalescing; agree on those semantics first to avoid competing edits.

### <a id="perf-04"></a>PERF-04 — First `updateStory` rereads its before-record

- **Severity / status / class:** minor; confirmed source; useful improvement.
- **Evidence:** `src/services/plugins/changeSet.ts:73`, `src/services/plugins/changeSet.ts:65`, `src/plugins/specs/specs.ts:126`, `src/plugins/epics/service.ts:76`. For an unpending Story, `updateStory` reads it, then `putStory` reads it again for `before`; bulk unlinking has also already loaded the Stories through `list`. `updateBoard` has the analogous double read at `src/services/plugins/changeSet.ts:100` and `src/services/plugins/changeSet.ts:92`.
- **Recommended change:** validate the updater's result and insert a change with the already-read `latest` as `before`; avoid routing that first update through the rereading public put path. Preserve validation and pending-update behavior. Reusing an earlier service-list record is a separate concurrency choice and is not required for this fix; do not add a public bypass API just to avoid one more read.
- **Acceptance:** first Story/Board update reads its stored record once; pending updates perform no stored read; original `before` remains stable over multiple updates; invalid update causes no save. Bulk unlinking retains all unrelated bags. Document the existing lack of a cross-process compare-and-swap guarantee rather than claiming the redundant read supplied one.
- **Dependencies / ownership:** same worker/files as PERF-03; reconcile with resiliency work on concurrent writes. The 4.72-second unlink duration includes writes and is not attributed solely to this defect.

### <a id="perf-05"></a>PERF-05 — Disabled definitions still evaluate their non-TUI modules

- **Severity / status / class:** minor; confirmed; informational now, lazy-registry abstraction optional.
- **Evidence:** `src/cli.ts:2`, `src/plugins/index.ts:4`, `src/services/plugins/host.ts:71`, `tsup.config.ts:4`. All definitions/commands/services are imported before checking `enabled`. `src/plugins/epics/index.ts:84`, `src/plugins/specs/index.ts:123`, `src/plugins/comments/index.ts:18`, and `src/tui/loadPlugins.ts:13` correctly defer active Plugin TUI imports.
- **Why it matters:** disabled means inactive, not unevaluated. Runtime configuration cannot tree-shake the static registry. Import-time exceptions occur before `loadPlugins`' activation catch. No unacceptable startup tax has been isolated for today's three built-ins.
- **Recommended change:** document this distinction now. Only if registry growth/import cost or import-failure isolation warrants it, use lightweight `{ id, name, description, load }` descriptors and load enabled definitions inside the host boundary. A descriptor registry is not needed merely because disabled modules appear in the bundle.
- **Acceptance if implemented:** disabled Plugin loader is never invoked; status still shows its metadata; enabled import failure becomes an attributed failed status; ordering/name clashes remain deterministic; ordinary CLI paths import no Ink/React/TUI chunk. Check emitted import graph in addition to source imports.
- **Dependencies / ownership:** architecture/host worker owns descriptors and registry types; conflicts with VER-01/DEP-01 and author-review registry proposals. Preserve the existing lazy TUI split.

### <a id="perf-06"></a>PERF-06 — Startup constructs the core command tree twice

- **Severity / status / class:** minor; confirmed; useful small improvement.
- **Evidence:** `src/main.ts:38`, `src/main.ts:102`, `src/main.ts:126`. `reservedNames()` creates a throwaway tree; startup later builds the real one. Root discovery/Plugin activation precede Commander version/help handling. Single warm-up-sensitive samples were 6.1 ms and 1.1 ms.
- **Recommended change:** let reserved-name extraction accept the already-created core program; attach Plugins to that program after loading. Retain `reservedNames()`'s convenient no-argument form for tests if useful. An exact normal `--version`/`-V` fast path can skip activation; do not broadly intercept mixed/invalid arguments and change Commander semantics.
- **Acceptance:** command/flag clashes and inherited options remain identical; global help still includes enabled Plugin commands; version output and usage/error behavior remain correct with malformed config/failing Plugin; a fixture startup counter proves plain version does not activate Plugins if that fast path is chosen.
- **Dependencies / ownership:** CLI worker owns `main.ts`; coordinate TEST-01 and optional PERF-05. Do not manually duplicate reserved option lists.

### <a id="perf-07"></a>PERF-07 — No repeatable scalability/read-budget benchmark

- **Severity / status / class:** minor; confirmed infrastructure gap; useful improvement, not mandatory benchmarking framework.
- **Evidence:** `vitest.config.ts:4`, `test/plugins/helpers.ts:27`, `src/services/plugins/runtime.ts:66`, `src/services/plugins/runtime.ts:185`. Existing suites verify behavior with small fixtures; the historical scripts expose scaling that passing tests did not catch.
- **Recommended change:** retain the evidence scripts in this report and optionally promote a small opt-in benchmark under `test/performance/` with a schema-validated generator. Separate startup, activation, no-hook/with-hook pipeline execution, parsing, Epic summaries, doctor, and bulk writes. Use deterministic call/read-count assertions for PERF-01/02 and repeated parsing below. The runner scans active Plugins in each stage and creates events only for handlers; with three built-ins, there is no evidence that hook indexing/event pooling is worthwhile.
- **Acceptance:** 100/1,000/5,000-story inputs validate and doctor succeeds before timing; exit failures invalidate a sample; mutations use fresh fixtures or explicitly report successive-state behavior; report multiple samples/environment details. Do not disable Zod validation, add global bag caches, or set machine-dependent CI timing thresholds based on these one-machine numbers.
- **Dependencies / ownership:** test/performance worker can proceed independently after helper ownership is agreed. Results should inform optional PERF-05, not presuppose it. Full pipeline-only timing was not measured in the preceding review.

### <a id="perf-08"></a>PERF-08 — Multi-Spec filtering reparses the bag per candidate slug

- **Severity / status / class:** minor; confirmed source, no measured incremental latency; useful local simplification (new finding).
- **Evidence:** `src/plugins/specs/index.ts:92`, `src/plugins/specs/specs.ts:110`, `src/services/plugins/runtime.ts:185`. `filter.some(slug => linkedSpecs(plugin, story).includes(slug))` invokes `readBag` for each candidate until a match.
- **Recommended change:** after verifying the filter is an array, calculate `const linked = linkedSpecs(plugin, story)` once and evaluate candidates against it. A Set is optional only if large link lists justify it; a shared parse cache is unnecessary.
- **Acceptance:** any-selected semantics, empty/non-array filters, invalid/missing bags, and early matches remain unchanged. A spy confirms at most one bag parse per Story for a multi-slug filter. Coordinate invalid-data read semantics with VER-02.
- **Dependencies / ownership:** Specs worker, same `index.ts` ownership as PERF-02; batch both edits.

### <a id="perf-09"></a>PERF-09 — Slug-only Specs controls load complete documents

- **Severity / status / class:** minor; confirmed source; useful improvement for many/large Specs (new finding).
- **Evidence:** `src/plugins/specs/tui.ts:21`, `src/plugins/specs/tui.ts:35`, `src/plugins/specs/index.ts:65`, `src/plugins/specs/specs.ts:78`, `src/services/plugins/changeSet.ts:254`. Form/filter controls need slugs; deletion guard needs presence; `listSpecs` reads every document serially for title/text and resolves its Board again per document.
- **Recommended change:** add a small `listSpecSlugs(plugin, board)` helper using the same top-level `.md`/slug rules. Use it in slug-only controls and guard; retain `listSpecs` for titled list output. If the guard should consider unreadable documents or all Plugin files differently, agree on that policy with resiliency; do not inadvertently change it during a performance edit.
- **Acceptance:** form/filter option sets and guard decisions match supported file semantics; unrelated/nested filenames are filtered consistently; slug-only consumers make no document-content reads. No repository-wide file-index abstraction is required.
- **Dependencies / ownership:** Specs worker with PERF-02/08; SEC-02 affects symlink/file inventory semantics.

### <a id="build-01"></a>BUILD-01 — Public Plugin API is not a distributable package entry

- **Severity / status / class:** minor today; confirmed; conditional external-loader gate, not a built-in release defect.
- **Evidence:** `package.json:6`, `package.json:11`, `tsup.config.ts:4`, `src/plugin-api/index.ts:1`, `src/plugin-api/tui.ts:1`. Package is private, ships `dist`, and has one CLI build entry; no public API exports/declarations are configured.
- **Recommended change:** retain relative source API imports for built-ins. When external packages are supported, deliberately export separate main/TUI API entries and declarations (same package or a small SDK package), with peer/dependency policy for React/Ink/Zod/Commander and module/Node compatibility. Do not turn the whole repository into a workspace to anticipate this.
- **Acceptance when scheduled:** pack/install an external sample Plugin without source-tree paths; typecheck it; execute against the installed host; ensure main API import does not eagerly load TUI. Verify the package contains all dynamic chunks. Changing `private` or adding a publication workflow requires a separate release decision.
- **Dependencies / ownership:** packaging worker after VER-01 and SEC-01 decisions; coordinates with author-review API packaging. No current code change is necessary solely for this finding.

## Testing findings

### <a id="test-01"></a>TEST-01 — Isolation exists, but authors must assemble internal harness wiring

- **Severity / status / class:** minor; confirmed; useful consolidation, public harness optional.
- **Evidence:** `test/plugins/helpers.ts:43`, `test/plugins/helpers.ts:48`, `test/plugins/fixtures/cli.ts:1`, `test/helpers/globalSetup.ts:16`, `docs/PLUGINS.md:304`. Helpers already accept arbitrary registries and deterministic clocks/ids; a fixture CLI already exists. There is no isolated-runtime impossibility here.
- **Recommended change:** document `pluginRoot` + `withPlugins(t, [plugin])` as the immediate testing recipe. If duplication warrants it, add a small `createPluginHarness({ registry, enabled, clock, ids, local })` helper returning the TempRoot/disposal, host, services, contexts, and warnings. A registry-specific CLI runner can reuse `main`; do not compile a CLI per individual test. Publish an external harness only with BUILD-01.
- **Acceptance:** two sample isolated Plugins get independent roots/status/contexts; deterministic values and disposal work; optional multiple-Plugin integration preserves order. Core tests retain direct storage access for assertions. A newcomer can run one Plugin's service tests from documented commands without discovering host internals.
- **Dependencies / ownership:** test-harness worker coordinates with author reviewer; keep helper exports internal initially. TEST-02/03 share helpers/build setup; do not let separate workers rewrite them concurrently.

### <a id="test-02"></a>TEST-02 — Repeated TUI setup wires warning delivery differently

- **Severity / status / class:** minor; confirmed; useful improvement.
- **Evidence:** `test/plugins/epicsTui.test.tsx:27` routes context warnings to its rendered toast store; `test/plugins/specsTui.test.tsx:19` and `test/plugins/specsTui.test.tsx:30` collect warnings elsewhere; `test/plugins/commentsTui.test.tsx:18` and `test/plugins/commentsTui.test.tsx:19` also use separate stores. `test/tui/helpers.tsx:34` and `test/tui/helpers.tsx:55` already supply frame/input helpers.
- **Recommended change:** add `test/plugins/tuiHarness.tsx` to create the App/context/host with one toast store and an inspectable warning collector. Ensure production-like loading/background-reaction settings are explicit; avoid subtly changing all existing tests' behavior. Add slot-specific render helpers only when used, and optional small stable snapshots for representative tabs/sections/screens. Do not snapshot every frame or replace interaction tests.
- **Acceptance:** a warning from a Plugin appears both in the collector and rendered toasts; test active/inactive keyboard focus, route return/reload, disabling/reloading, and cleanup. Fix terminal dimensions/clock/ids for any snapshot. Factor wrappers according to the one-component-per-file rule.
- **Dependencies / ownership:** same test-harness worker as TEST-01; collaborate with resiliency's reaction/focus tests. The identified duplication is setup wiring, not redundant behavior coverage.

### <a id="test-03"></a>TEST-03 — Single in-process test runs build both CLI bundles

- **Severity / status / class:** minor; confirmed configuration behavior, overhead not separately measured; useful optional feedback-loop improvement.
- **Evidence:** `vitest.config.ts:7`, `test/helpers/globalSetup.ts:11`, `test/helpers/globalSetup.ts:12`. Global setup builds production and fixture CLIs even when the filtered tests use only services or Ink.
- **Recommended change:** simplest option: a focused Vitest config/project sharing base settings but omitting CLI global setup, and a documented command for unit/TUI tests. Attach build setup only to CLI suites. Four projects or a generic build cache are not required; do not skip fresh builds for tests that call `runCli`.
- **Acceptance:** one filtered service/TUI test can run without invoking tsup; production/fixture CLI tests still build the matching current source; full supervisor suite remains discoverable. Compare feedback-loop timing before adopting extra configuration.
- **Dependencies / ownership:** test-tooling worker with TEST-01; owns `vitest.config.ts` and `globalSetup.ts` together. Coordinates with packaging changes.

### <a id="test-04"></a>TEST-04 — No explicit checklist ties each mutation to both surfaces

- **Severity / status / class:** minor; confirmed inventory gap; useful improvement.
- **Evidence:** `docs/PLUGINS.md:87`, `test/plugins/epicsTui.test.tsx:57`, `test/plugins/specsTui.test.tsx:46`, `test/plugins/commentsTui.test.tsx:39`, `test/plugins/specs.test.ts:98`. Existing suites cover substantial behavior, including force deletion at service level, but not UI-01's TUI path.
- **Recommended change:** keep a compact operation/surface checklist (the matrix below is a starting point). Add ordinary CLI/TUI tests for the uncovered force retry and body semantics; compare persisted results for equivalent inputs. A table file such as `test/plugins/parityCases.ts` is optional if it actually drives useful tests; do not invent a new test DSL.
- **Acceptance:** all listed mutations have a CLI and TUI test or an explicit supported exception; cancel/confirm behavior, link replacement/removal, and preserving other bags are checked. UI-01 and UI-02 each have a focused regression. Read-only formatting differences are not treated as mutation failures.
- **Dependencies / ownership:** test-harness worker coordinates Plugin-specific test owners. Parity fixes should land with their regression tests, not wait for a generic framework.

## CLI/TUI consistency findings

The matrix below is source-confirmed reachability, not a fresh keyboard walkthrough. Existing tests support many happy paths. Representative implementations: `src/plugins/epics/commands.ts:26`, `src/plugins/epics/EpicForm.tsx:22`, `src/plugins/epics/EpicDetail.tsx:33`, `src/plugins/epics/tui.ts:10`; `src/plugins/specs/commands.ts:24`, `src/plugins/specs/SpecFormScreen.tsx:22`, `src/plugins/specs/SpecTab.tsx:27`, `src/plugins/specs/SpecDetailScreen.tsx:24`, `src/plugins/specs/tui.ts:14`; `src/plugins/comments/commands.ts:25`, `src/plugins/comments/CommentsTab.tsx:50`, `src/plugins/comments/CommentFormScreen.tsx:16`.

| Plugin | Mutation | CLI | TUI | Assessment |
| --- | --- | --- | --- | --- |
| Epics | Create/edit | `epics create/edit` | List → form; detail → edit form | Present. |
| Epics | Close/reopen | `epics close/reopen` | Detail `c` toggle | Present. |
| Epics | Delete/unlink all Stories | `epics delete` | Detail `d` confirmation | Present. |
| Epics | Link/unlink Story | Story `--epic`/`--no-epic` | Story form Epic select | Present. |
| Specs | Create/edit/delete Board Spec | `specs` commands with Board/slug | Specs list/form/detail | Present. |
| Specs | Create/edit/delete Story Spec | `specs ... --story` | Story Spec tab/form | Present. |
| Specs | Replace/add/remove links | Story `--spec`/`--add-spec`/`--remove-spec` | Story multiselect replaces selection | Equivalent final-state capability; separate incremental controls not needed. |
| Specs | Force-delete empty Board containing Specs | `boards delete --force` | No force retry on Plugin-only conflict | UI-01. |
| Comments | Add/edit/delete Story Comment | `comments` commands with Story key | Story Comments tab/form | Reachable; UI-02 changes whitespace semantics. |
| Comments | Add/edit/delete Task Comment | `comments` commands with Task id | Task Comments tab/form | Reachable; same UI-02. |
| Plugin management | Enable/disable | `plugins enable/disable` | Settings toggle/reload | Present; TUI reloads immediately, CLI next invocation. |
| Doctor | Built-in missing-link fixes | `doctor --fix` | Doctor fix surface | Same service path; invalid bags currently have no automatic recovery. |

Epic/Spec filters exist on CLI Story lists and TUI Stories/board; Epic list open/closed/all is selectable in both. Story/Task rows use the shared rows functions (`src/tui/screens/stories/detail.tsx:42`, `src/tui/screens/tasks/TaskDetailScreen.tsx:41`). Specs' Markdown editor/raw CLI output and TUI rendered text can differ legitimately. Actions are explicitly TUI-only under ADR-0017; built-ins currently declare no Actions.

### <a id="ui-01"></a>UI-01 — Empty Boards with Specs have no TUI force-delete path

- **Severity / status / class:** major; confirmed control flow, not newly reproduced; current parity release gate.
- **Evidence:** `src/plugins/specs/index.ts:63`, `src/services/plugins/runtime.ts:105`, `src/services/boards.ts:64`, `src/tui/screens/boards/index.tsx:56`, `src/tui/screens/boards/index.tsx:166`.
- **Trigger:** delete a Board with zero Stories and at least one Board Spec. Specs returns a guard rejection; runtime adds only `details.plugin`; TUI force retry requires numeric `details.stories`, so it shows an error and returns to the list. With Stories, core's earlier conflict does offer force retry, which then bypasses the Specs guard.
- **Recommended change:** agree on a small machine-readable forceable-Board-deletion signal in conflict/guard details, e.g. `canForce` plus a reason. Preserve it through runtime. TUI may offer `{ force: true }` only for that signal and after confirmation; it must not bypass arbitrary guard failures or match error prose. Confirmation should describe removal of contained Stories and Plugin files without hard-coding the Specs id.
- **Acceptance:** empty Board + Spec: cancel preserves everything; confirm force removes the Board/Spec; Board + Stories + Specs still works; non-forceable Plugin guard never gets a force button; CLI still exits 4 without force and succeeds with force. Error JSON retains attribution.
- **Dependencies / ownership:** runtime/error-contract owner changes guard/conflict types and mapping; TUI owner changes Board deletion flow; Specs owner marks this specific guard forceable. Coordinate one contract before parallel edits to `types.ts`/`runtime.ts`. TEST-04 supplies coverage, not a blocker to the fix.

### <a id="ui-02"></a>UI-02 — TUI Comments trim content that CLI preserves

- **Severity / status / class:** minor; confirmed source; useful consistency fix (new finding).
- **Evidence:** `src/plugins/comments/CommentFormScreen.tsx:17` calls `.trim()` before save; `src/plugins/comments/comments.ts:51` stores the supplied body and `src/plugins/comments/comments.ts:111` only checks `body.trim()` for emptiness; CLI passes `readBody` to the service at `src/plugins/comments/commands.ts:28` and `src/plugins/comments/commands.ts:38`.
- **Why it matters:** leading indentation or deliberately surrounding whitespace in Markdown can survive a CLI edit but be removed by saving the TUI form. Shared services alone do not guarantee equivalent submitted values.
- **Recommended change:** pass raw form body text to `addComment`/`editComment`; retain service-side whitespace-only rejection. Alternatively adopt one documented normalization in the service, but preserving user Markdown is preferable to silently stripping it.
- **Acceptance:** equivalent CLI/TUI bodies with first-line indentation, blank edges, and multiline Markdown store identical text; whitespace-only input still rejects without changing the Thread; both Story and Task forms follow the same rule.
- **Dependencies / ownership:** Comments worker owns form/service tests; coordinates TEST-04. No Plugin API change is needed.

## Documentation findings

### <a id="doc-01"></a>DOC-01 — Current architecture/contracts contradict source

- **Severity / status / class:** major for a document used as an implementation contract; confirmed; useful documentation correction rather than runtime blocker.
- **Evidence:** `docs/ARCHITECTURE.md:6`/`:84` use `issues`; `:12` omits the return of Epics as a Plugin; `:26`/`:28` require absent Stage/Task ownership fields; `:54` says Board config optional; `:66` describes SQLite. `docs/spec/contracts.md:87`/`:93`/`:105` retain core Comments/bags on Comments; `:194` advertises Plugin options on Comments commands absent from `PluginOptionCommand`; `:271` retains core Comments service. `src/schemas/story.ts:17`, `src/services/plugins/types.ts:303`, `src/storage/repositories.ts:68` establish actual contracts.
- **Recommended change:** rewrite stale Architecture storage/layer wording to current file-backed behavior; state “no Epics in core; Epics are a built-in Plugin”; distinguish required Board record/config from optional cascade fields. Remove core Comments declarations/options/service from active contracts and link the Plugin model. Also include ADR-0018 in `docs/ARCHITECTURE.md:100`. Preserve historical specification text only if clearly labeled non-current.
- **Acceptance:** all named commands/fields/services match current types; examples compile or are verified against schemas; no current architecture description implies SQLite. Documentation owner checks references to Comments across specs/README and assigns any additional stale occurrences rather than assuming this list is exhaustive. `docs/TECHNICAL_DETAILS.md` is brief but its library choices match `package.json`; expanding it is optional, with a link to the main architecture/API docs sufficient.
- **Dependencies / ownership:** one documentation owner coordinates all reviewers' Architecture/contracts corrections; must not implement old contracts in source to make the documents true.

### <a id="doc-02"></a>DOC-02 — Historical ADR language is presented as current implementation status

- **Severity / status / class:** minor; confirmed; useful correction.
- **Evidence:** `docs/adr/0012-plugins-intercept-service-operations.md:3` says doctor fixes will become operations; `docs/adr/0013-plugin-files-live-beside-what-they-belong-to.md:5` says only `story.json` currently moves. Actual fix runner/folder movement: `src/services/doctor.ts:606`, `src/services/plugins/changeSet.ts:165`. `docs/PLUGINS.md:17` lists Git among API capabilities, while `src/services/plugins/types.ts:241` has none; ADR-0016 explicitly marks Git unbuilt at `docs/adr/0016-git-automation-design.md:7`.
- **Recommended change:** preserve ADR rationale and add a dated implementation-status note for 0012/0013; separate implemented and planned capabilities in PLUGINS. Keep ADR-0016 explicitly planned. The rest of ADR-0009–0018 largely matches source; their “same pipeline/one save” statements are intended design, not an assertion of filesystem-wide transactional atomicity or runtime enforcement of Plugin conduct.
- **Acceptance:** readers can determine what is built without comparing Git history; links and capability names match API. Do not overwrite historical rationale or present future Git execution as callable.
- **Dependencies / ownership:** documentation owner with GIT-01 and resiliency's save/reaction semantics. No source changes required.

### <a id="doc-03"></a>DOC-03 — Writing guide lacks a complete executable tutorial/reference

- **Severity / status / class:** minor; confirmed bounded gap; useful improvement.
- **Evidence:** `docs/PLUGINS.md:178`, `docs/PLUGINS.md:194`, `docs/PLUGINS.md:304`, `src/plugin-api/index.ts:40`. Existing guide already covers contexts, commands, TUI slots, pipeline and test direction; its main example uses placeholder hooks/commands.
- **Recommended change:** add `docs/plugins/TUTORIAL.md` for one small Plugin with definition/glossary, schema, CLI command, transform/input, TUI field, doctor check and isolated test. Add a concise `docs/plugins/API.md` (or equivalent sections in PLUGINS) documenting public exports, supported operation names, error policy, lifecycle, file/pending semantics, focus, and testing. Use compilable fixture snippets where they prevent drift; no docs generation tool is required.
- **Acceptance:** tutorial compiles using only allowed imports and runs in an isolated registry; no undocumented future capability appears; API reference identifies both public entry modules and contextual types. Retain the existing guide and link additional depth instead of duplicating it.
- **Dependencies / ownership:** author-experience/documentation owners coordinate with TEST-01. Public package tutorial waits for BUILD-01; built-in tutorial does not.

### <a id="doc-04"></a>DOC-04 — Public JSDoc leaves lifecycle/ownership contracts underspecified

- **Severity / status / class:** minor; confirmed documentation gap; useful clarification.
- **Evidence:** `src/services/plugins/types.ts:89`, `:99`, `:122`, `:240`, `:407`, `:458`, `:489`; `src/plugin-api/tui.ts:20`; behavior at `src/services/plugins/runtime.ts:88`, `:185`, `:205`, `src/tui/app.tsx:55`, `src/tui/loadPlugins.ts:34`. `definePlugin` already has JSDoc at `src/plugin-api/index.ts:97`; aliases/re-exports need not each duplicate upstream documentation.
- **Recommended change:** specify pending versus stored file reads; deletion/renumber lookup semantics; live mutable record references versus intended read-only access; repeated starts on host reload and absence of teardown; separate saves from nested services; field refresh dependencies and tab/screen focus; `readBag` failure policy; editor surface restriction. Clarify which methods validate records instead of “Every method” at types line 99. Document current behavior first; if owners tighten it, update docs with that change. `useAsync` already documents error toasts/reload behavior at `src/tui/hooks/useAsync.ts:12`; reference and extend its actual lifecycle limits, not an invented cancellation guarantee.
- **Acceptance:** a Plugin author can tell whether a read sees pending data, when a callback runs again, and what mutation is permissible. Small examples demonstrate updater usage and active focus. JSDoc does not claim deep immutability or transactions unless implemented.
- **Dependencies / ownership:** API/runtime owner approves semantics; documentation owner writes prose. Strong overlap with architecture/resiliency findings on mutable views/reentrancy; do not independently redesign these interfaces in a docs task.

### <a id="doc-05"></a>DOC-05 — Glossaries omit supported null/no-target cases and precise heading rule

- **Severity / status / class:** nit; confirmed; useful small documentation edit.
- **Evidence:** `CONTEXT.md:90` Action definition omits `none` supported by `src/services/plugins/types.ts:366`; `CONTEXT-MAP.md:14` says author is Me, while `src/plugins/comments/comments.ts:105` permits null; `src/plugins/comments/CONTEXT.md:8` can be clearer about authorship; `src/plugins/specs/CONTEXT.md:8` says first heading while `src/plugins/specs/specs.ts:34` searches the first `# ` line.
- **Recommended change:** say Action can target no particular record; Comment authors are Me when identifiable, otherwise null; Spec title is the first level-one `# ` heading. Do not redefine the parser as a full Markdown parser in this wording fix.
- **Acceptance:** wording matches valid anonymous Comments, no-target Actions and an H2 before H1. Preserve contextual `_Avoid_` vocabulary lists and tests (`test/e2e/language.test.ts:30`).
- **Dependencies / ownership:** documentation/glossary owner; no code dependency. Corrected core line reference from the previous report is 90, not 83.

## Observability findings

### <a id="obs-01"></a>OBS-01 — No opt-in successful-operation/hook trace

- **Severity / status / class:** minor (downgraded); confirmed; useful improvement, not current release gate.
- **Evidence:** `src/services/plugins/runtime.ts:66`, `:97`, `:116`, `src/services/plugins/host.ts:84`, `src/main.ts:21`. Source search found no `--debug`, `ROWBLY_DEBUG`, or Plugin trace facility. Pipeline exceptions already carry Plugin/operation/stage, reactions/rows already warn, and list/doctor already expose failures.
- **Recommended change:** a small optional trace callback on runtime context, enabled via one CLI/env debug switch, recording Plugin id, operation/stage, elapsed duration, outcome, and affected record identifiers/counts. Start with load/pipeline stages; presentation callbacks can use the same callback as needed. Emit stderr for CLI and a bounded diagnostic sink for TUI; do not route verbose trace events through ordinary toasts. Correlation ids are useful when background reactions overlap; full telemetry infrastructure is not required.
- **Acceptance:** disabled tracing does no snapshot serialization or unbounded allocation; trace proves registry stage order and identifies a slow callback; guard rejection/save/reaction failure can be distinguished; JSON stdout stays parseable; body text, complete bags/settings, and secrets are omitted by default. To claim what a transform changed, compare a bounded summary before/after that callback rather than only attributing the final combined Change Set.
- **Dependencies / ownership:** runtime/CLI diagnostics owner coordinates resiliency reaction lifecycle and OBS-02. Cache/index optimizations do not depend on shipping tracing.

### <a id="obs-02"></a>OBS-02 — Attribution is incomplete outside protected pipeline hooks

- **Severity / status / class:** minor; confirmed; useful debugging improvement.
- **Evidence:** `src/services/stories.ts:271` filter invocation, `src/commands/_shared.ts:74` option conversion, `src/commands/plugins.ts:124` command action, `src/services/plugins/runtime.ts:205` custom body via unwrapped `body` at `:94`, `src/services/doctor.ts:538` custom finding conversion. Expected Plugin command errors intentionally retain normal exit codes (`docs/PLUGINS.md:244`); do not call their propagation itself a bug.
- **Recommended change:** attach Plugin/callback metadata at known Plugin boundaries. Preserve expected `RowblyError` code/exit/hint and core pass-through; attribute unexpected exceptions. A shared helper is useful only if it simplifies these few sites. Add `details.plugin` when converting custom doctor findings; prefixed codes already identify them to humans. Preserve cause information for debug output without exposing raw bodies.
- **Acceptance:** JSON errors from filter, option conversion, command and custom body identify origin; expected Usage/Validation/NotFound retain codes; replacement `core()` pass-through remains correct. Custom doctor finding JSON includes explicit Plugin id. Do not promise all arbitrary thrown errors can be reliably distinguished as Plugin-vs-core when provenance is unknown.
- **Dependencies / ownership:** resiliency/runtime worker coordinates CLI and doctor edits; OBS-01 can consume the metadata. Shared `types.ts`/error changes must be consolidated with UI-01.

### <a id="obs-03"></a>OBS-03 — Listing shows raw settings/status, not effective configuration/contributions

- **Severity / status / class:** minor; confirmed; useful diagnostics, detailed manifest optional.
- **Evidence:** `src/services/plugins/service.ts:21` returns raw root settings; `src/commands/plugins.ts:149`/`:159` show status/reason/settings; `src/services/plugins/host.ts:20` lacks version/order metadata. Existing `known`, `enabled`, `loaded`, and reason fields are good; the registry/list order is already deterministic.
- **Recommended change:** most useful immediate addition is `plugins show <id> --board <id>` with raw root, Board overrides, and effective validated settings clearly distinguished, including schema defaults. Hook names/CLI options already declared on definitions can be listed without executing callbacks. TUI contributions of disabled Plugins cannot be enumerated without loading TUI or adding separate metadata; omit them or mark “not loaded” rather than creating mandatory manifests. API/version details wait for VER-01.
- **Acceptance:** Board list replacement/deep-merge/default behavior is represented correctly; unknown/failed/disabled settings remain inspectable with honest labels; detailed output does not import inactive TUI; compact list is retained; JSON has documented field semantics.
- **Dependencies / ownership:** CLI/plugins-service worker coordinates API settings semantics and optional PERF-05. No requirement to make runtime definitions a second static manifest today.

## Versioning and migration findings

### <a id="ver-01"></a>VER-01 — No explicit Plugin API compatibility/version policy

- **Severity / status / class:** minor for built-ins; confirmed absence, future impact inferred; conditional external-loader gate.
- **Evidence:** `src/services/plugins/types.ts:481`, `src/services/plugins/host.ts:84`, `src/plugin-api/index.ts:97`, `package.json:3`. Application version and persisted record `version` do not identify API compatibility. Built-ins compile with the host, so no present external ABI mismatch is demonstrated.
- **Recommended change:** document the current policy as internal/unreleased and coordinated with the host release. Before accepting external packages, choose a simple API major/version or supported range, validate it before activation, and report required/actual versions. Add `docs/plugins/COMPATIBILITY.md` or an equivalent PLUGINS section covering breaking/additive changes, dependency/library compatibility, deprecation, and release notes. Do not build a semver-range engine until range declarations are actually needed.
- **Acceptance:** external incompatible definition fails before `start`; status identifies incompatibility; compatible definition runs; policy distinguishes API version, package version, and storage version. Current built-ins remain straightforward to declare.
- **Dependencies / ownership:** architecture/API release owner, before BUILD-01/DEP-01. Exact field signature is a policy decision, not mandated by this review.

### <a id="ver-02"></a>VER-02 — Invalid bags can be mistaken for absent data; migration policy is undefined

- **Severity / status / class:** major for silent mutation data loss; confirmed code path; invalid-write protection is a current release gate. Generic migration/versioning infrastructure is optional until schema evolution.
- **Evidence:** `src/services/plugins/runtime.ts:185` returns undefined for both absent and invalid; `src/plugins/comments/comments.ts:31` interprets that as an empty Thread; `:89` rewrites the bag after appending; `src/plugins/specs/specs.ts:110` also defaults to an empty link list and `src/plugins/specs/specs.ts:143` uses it for incremental link edits. `src/plugins/comments/model.ts:13`, `src/plugins/epics/model.ts:13`, `src/plugins/specs/specs.ts:14` have no bag version. Epic files require literal 1 at `src/plugins/epics/model.ts:4`. Doctor already warns on invalid bags at `src/services/doctor.ts:514`.
- **Confirmed impact:** a structurally invalid existing Comments bag passes core's opaque-bag schema, `commentsOn` yields `[]`, and add rewrites it with only the new Comment. Incremental Specs add/remove can likewise rebuild an invalid bag from the empty fallback, replacing or removing it. No future schema change is necessary for those paths. An additive future bag field being dropped during a Plugin-owned rewrite is an inferred compatibility risk, not automatically a violation of today's known schema.
- **Recommended change:** retain tolerant presentation reads if desired, but introduce a strict mutation read/validation path that distinguishes absent from invalid and refuses to overwrite invalid data. Add focused recovery guidance. Decide schema-evolution policy before changing shapes: existing unversioned bags may be legacy v1; future unsupported versions should be recognized and preserved/refused. A Plugin-specific migration command with preview/backups/idempotence is enough for a first real migration; do not require a global migration engine or immediate version fields everywhere.
- **Acceptance:** malformed Story and Task Comments bags are unchanged after rejected add/edit/delete; absent Thread still accepts add; incremental Specs edits do not erase an invalid original bag; unrelated Plugins' data stays opaque/preserved; doctor and errors point to repair. Explicit full replacement/reset has its own deliberate semantics and should not be confused with an incremental edit. Before introducing v2, test old reader/new data, unsupported version refusal, idempotent supported migration, and no automatic startup writes. Define unknown-field preservation explicitly rather than assuming Zod defaults provide forward compatibility.
- **Dependencies / ownership:** resiliency/bag-runtime worker owns strict read semantics; Comments/Specs/Epics workers adopt them only where mutations need them. Strong overlap with invalid-bag findings from siblings: merge into one task. VER-01 is not a prerequisite to stopping current data loss.

### <a id="ver-03"></a>VER-03 — Historical top-level Comments are silently discarded on a later write

- **Severity / status / class:** major if historical core data is supported; confirmed documented behavior; conditional compatibility gate, not an unannounced deviation from ADR.
- **Evidence:** `docs/PLUGINS.md:122`, `:154`, `docs/adr/0018-comments-are-a-built-in-plugin.md:9`, `src/schemas/story.ts:17`, `:29`, `src/storage/jsonStore.ts:34`, `:49`, `src/services/doctor.ts:134`. Current schemas omit top-level Comments; parsed values and schema-serialized writes strip them. `docs/adr/0014-epics-return-as-a-built-in-plugin.md:5` also explicitly declines old Epic migration.
- **Recommended change:** supervisor/release owner decides whether previous core data is supported. If yes, provide a small explicit importer or targeted raw-JSON legacy finding before writes, with a backup/migrate/intentional-discard path. If no, prominently explain that enablement does not import legacy data, where it remains, when it is dropped, and how to back up/export before upgrade. Do not add automatic import of old bags on startup against the accepted decision.
- **Acceptance:** legacy Story/Task Comments and old Epic files/links have documented, tested upgrade behavior; enabling a Plugin alone is not advertised as migration. If supported, diagnostics detect fields before schema stripping and mutation does not erase them unnoticed. Preserve ids/authors/timestamps on import and define duplicate/Comment-bag handling if that importer is chosen.
- **Dependencies / ownership:** release/documentation owner resolves compatibility scope; one migration worker implements chosen data handling. Coordinate VER-02 and doc cleanup. This is not an unconditional blocker for an unreleased, fresh-root-only plugin system.

## Safety and future extension findings

### <a id="sec-01"></a>SEC-01 — Architectural import restrictions do not confine runtime code

- **Severity / status / class:** major if constrained/untrusted external loading is promised; confirmed current authority, future threat inferred; conditional gate.
- **Evidence:** `test/architecture.test.ts:23`, `:111`; `src/services/plugins/types.ts:252`; `src/services/plugins/changeSet.ts:128`; `src/services/plugins/runtime.ts:202`. Regex source checks enforce allowed literal imports for repository code, not arbitrary computed imports/globals. In-process Plugins receive services (including `plugins.context` for other active Plugins), mutable core Change Sets and configuration writers, and can invoke nested operations. Own-file namespacing is not record/bag ownership enforcement.
- **Recommended change:** document built-ins as trusted code. Before committed configuration can load external code, decide trust policy and require local authorization for new package identities/versions independent of committed enablement. A supported full-trust external mode is a valid simple choice; say it is full-trust. If constrained/untrusted code is required, use an isolated process and audited capability protocol, including phase restrictions and data authority. Do not claim JavaScript object wrappers or an import linter create a sandbox.
- **Acceptance when scheduled:** cloning/enabling untrusted code does not silently execute it; trust state is local and scoped; reads/writes/process/editor authority is explicit; constrained mode cannot directly access arbitrary Node/filesystem/network authority through a claimed boundary. Test against that stated threat model, including access through other Plugin contexts.
- **Dependencies / ownership:** architecture/security owner before loader work; coordinate sibling mutation/reentrancy findings. No sandbox implementation is requested for today's trusted built-ins.

### <a id="sec-02"></a>SEC-02 — Lexical Plugin filenames do not establish physical filesystem containment

- **Severity / status / class:** major for a confined-files capability; confirmed missing real-path checks, escape impact inferred from filesystem semantics; conditional gate.
- **Evidence:** `src/services/plugins/changeSet.ts:36`, `:278`, `:281`; `src/storage/files.ts:7`, `:17`, `:31`; `src/storage/system.ts:32`; `src/services/plugins/changeSet.ts:195`. Relative-name validation blocks absolute/traversal segments. Reads and direct Plugin text writes follow final symlinks; a symlinked containing directory can redirect mutations outside the nominal scope. Deleting a final symlink ordinarily removes the link, not its target.
- **Recommended change:** first specify allowed symlink behavior, including a deliberately symlinked Data Root. If confinement is promised, resolve/check physical scope roots and parents centrally in storage, and reject unsafe link traversal for reads/writes/list/deletion. Keep paths relative to their permitted scope, not merely the entire Data Root. Explain limitations of a check-then-use approach under concurrent filesystem changes; do not advertise it as race-proof without implementing stronger handling.
- **Acceptance:** tests for final file links, parent-directory links, missing/new files, record-folder links, Data Root links, safe nested paths and rejection outside scope. A write must not modify an outside sentinel; deletion through a parent link must not remove an outside sentinel. List/read semantics are consistent with the declared policy.
- **Dependencies / ownership:** storage/security worker; conflicts with PERF-02/09's inventory optimization and resiliency's file-write changes. Fix shared resolver once rather than duplicating it in Plugins.

### <a id="sec-03"></a>SEC-03 — Command-only editor restriction is unenforced at runtime

- **Severity / status / class:** minor; confirmed; useful defensive API correction.
- **Evidence:** `src/services/plugins/types.ts:260`, `src/services/plugins/runtime.ts:207`, `src/storage/system.ts:49`. All contexts receive editor capability; editor inherits terminal streams. Built-in Specs calls it only from CLI at `src/plugins/specs/commands.ts:57`, and uses its own TUI form otherwise.
- **Recommended change:** explicitly track execution surface/capability availability and reject TUI `editText` calls with an attributed supported error. Exposing no editor capability to TUI is another straightforward choice if the types remain usable. Only implement terminal suspension/resumption when a real TUI editor handoff is requested. Respect `$EDITOR` arguments; the existing intentional shell execution of user-configured EDITOR is not by itself an injection finding.
- **Acceptance:** fixture TUI call fails without launching a subprocess or touching terminal state; CLI call still honors VISUAL/EDITOR and cleans up; context reload retains surface. Normal Specs TUI editing remains unchanged.
- **Dependencies / ownership:** runtime/TUI lifecycle owner; coordinate author-review capability design. No general process capability needed.

### <a id="git-01"></a>GIT-01 — ADR-0016 needs narrowly scoped host capabilities

- **Severity / status / class:** major before Git is advertised implemented; confirmed missing capabilities and inferred integration requirements; conditional feature gate.
- **Evidence:** `docs/adr/0016-git-automation-design.md:9`, `:11`, `src/services/plugins/types.ts:241`, `:115`, `src/storage/system.ts:65`, `src/services/context.ts:36`. `gitUserEmail` is internal identity lookup, not Plugin execution. Context service resolves Board/Me but does not expose Local State bags. Own-file scopes cannot install external Git hooks.
- **Already supported:** ordinary Plugin commands; saved Change Sets; async reactions with warning-only failure; CLI awaits and TUI backgrounds them; Local State bag writes via Change Sets; Git-event commands can call core Story/doctor services through the pipeline.
- **Missing for this ADR:** repository resolution from Data Root (not caller cwd); structured Git execution; read access to the Plugin's local preferences; actual `core.hooksPath` discovery/install/chaining and executable handling; defined hook args/stdin; loop suppression for commits triggering hooks; ordering of overlapping TUI Git side effects. “Background” does not mean ordered across operations; there is no cancellation/drain/teardown contract here.
- **Recommended change when scheduled:** add host-owned Git methods using argv arrays and resolved repository scope with bounded output/timeouts; add a narrow hook installation/update/remove service rather than arbitrary external file writes. Add a local-bag reader if needed by automatic preference decisions. Define how branch transitions detect Stage Category `in_progress` via effective configuration, not a hard-coded Stage key. Define correlation/reentrancy markers and a per-repository queue only if automatic effects can overlap. Uninstall and ownership checks are useful hook lifecycle requirements, not present command promises.
- **Acceptance:** nested Data Root and root-is-repository cases, no-Git failure, differing cwd, custom hooks path, existing hook chaining, reinstall/ownership, args/stdin, executable script, Story transitions with custom Stage keys, two overlapping changes, and Git→Rowbly→Git loop prevention. Failed Git side effects do not change successful Rowbly write status; user can diagnose them.
- **Dependencies / ownership:** Git feature owner with runtime/reaction lifecycle and storage-capability owners. Coordinates SEC-01/02, VER-01 and OBS-01 when those features are in scope; no requirement to ship them all just to retain ADR-0016 as a design.

### <a id="dep-01"></a>DEP-01 — Dependency semantics are not implemented, but current registry can evolve

- **Severity / status / class:** minor now; confirmed absent metadata, future impact inferred; conditional dependency-feature gate.
- **Evidence:** `docs/PLUGINS.md:11`, `src/services/plugins/types.ts:481`, `src/services/plugins/host.ts:71`, `:116`, `src/services/plugins/types.ts:213`. Registry order handles current built-ins. `markFailed` removes one active Plugin but has no dependent propagation. Custom operation inputs/results are intentionally untyped string hook names.
- **Recommended change:** defer until a Plugin requires another. Then define required versus optional dependencies, version expectations, missing/cycle behavior, failure propagation (including TUI import failure), and enable/disable policy. Stable topological ordering can preserve original registry order for unrelated Plugins; explicitly decide how it interacts with flag/key/replacement clash winners. For a couple of in-repository built-ins, a minimal validated dependency list may suffice. Typed exported service/operation contracts are optional when a concrete interoperability consumer benefits; direct cross-folder imports should not bypass the Plugin API boundary.
- **Acceptance when scheduled:** missing/disabled/incompatible required dependency, optional absence, cycle, stable independent order, downstream failure, and dependent-disable behavior are tested; errors name the dependency chain; config is not silently rewritten/auto-enabled without a chosen policy. Existing dependency-free order stays unchanged.
- **Dependencies / ownership:** architecture/host worker owns loading graph; combines optional PERF-05 and VER-01 if chosen. Coordinate API author's interoperability design. The present system is extendable, not falsely claimed “ready without rework.”

## Parallel execution ownership and sequencing

| Work package | Findings | Main files | Coordination rule |
| --- | --- | --- | --- |
| Epic summaries | PERF-01 | `src/plugins/epics/service.ts`, `EpicList.tsx`, Epic tests | Independent of runtime indexing; coordinate Epic service refactors. |
| Specs reads/filtering | PERF-02, PERF-08, PERF-09 | `src/plugins/specs/index.ts`, `specs.ts`, `tui.ts`, Specs tests | One worker; agree on inventory/unreadable/symlink semantics before changing existence checks. |
| Change Set performance | PERF-03, PERF-04 | `src/services/plugins/changeSet.ts`, pipeline tests | One owner with architecture/resiliency identity/coalescing edits. |
| Invalid-data mutation safety | VER-02 | runtime bag API, Comments mutation/read paths, bag tests | Merge sibling invalid-data findings; do minimal protection before migration infrastructure. |
| Board force retry | UI-01 | guard/conflict contract, runtime, Specs guard, Board TUI/tests | Contract first; runtime and TUI workers then implement coordinated consumers. |
| Comments content | UI-02 | `CommentFormScreen.tsx`, Comments CLI/TUI tests | Can be local after bag safety interface is agreed. |
| Test harness/tooling | TEST-01/02/03/04, PERF-07 | `test/plugins/helpers.ts`, new used helper, test configs/setup | One helper/config owner; behavior coverage remains with feature workers. |
| Diagnostics | OBS-01/02/03, PERF-06 | runtime/CLI/service/doctor | Coordinate shared runtime/error types with force retry and resiliency. |
| Documentation | DOC-01–05, policy part of VER-01/03 | active architecture/contracts/guide/glossaries | One owner reconciles all reviewers; waits for agreed semantics, not optional future implementations. |
| Deferred features | PERF-05, BUILD-01, broader VER-01/02, SEC-01/02, GIT-01, DEP-01 | registry/host/package/storage/API | Separate scoped work when requested. Do not silently fold into performance fixes. |

Tests/acceptance criteria in this report are work-plan requirements; they were not added or executed in this report-only task. The supervisor should assign a single owner for shared `types.ts`, `runtime.ts`, `changeSet.ts`, and helper/config files to prevent parallel churn.

### Supervisor plan cross-check

The consolidated integrity decisions agree with the confirmed issues here: invalid-bag protection is P0, deletion parity is P1, performance/harness/docs are P2, and published APIs/compatibility/trust are P3. The README correctly treats transactions, concurrency, immutable identity, reentrancy and doctor identity as higher priority than this report's local top-ten ranking. No conflicting integrity recommendation is retained.

Ownership mapping to that plan: PERF-03/04 and physical path handling belong to **WP02**, with WP07 measuring them; Specs/Epic optimizations and UI-02 belong to **WP08**, with WP07 read-budget tests; runtime attribution belongs to **WP01**, definition/CLI attachment and startup to **WP06**; **WP04** owns shared type signatures and the editor-capability surface; UI-01 joins WP04's conflict contract, WP08's guard, and WP05's Board TUI consumer; TEST findings belong to WP07; DOC/trace specifications to WP09; future loader/package/version policy to WP10.

Important additions for the supervisor's finding index: **PERF-08**, **PERF-09**, and **UI-02** are new, small confirmed findings. The README's concurrent update already includes them under WP08; keep that ownership rather than creating new work packages. SEC-03 is listed in the README under WP10, but the actual editor restriction can be handled now by WP04's already-chosen CLI command context; it need not wait for external loading. This is an ownership clarification, not a request for a second runtime surface flag if the CLI-context split solves it.

Recommendations explicitly deferred/rejected here: no global file/bag cache; no public harness before the package boundary; no mandatory contribution manifest; no dependency graph, generic migration engine, or operation DSL without a real consumer; no blanket INTERNAL wrapping of expected errors; no automatic legacy migration; no security containment claim from in-process wrappers; no speculative sandbox implementation. A supported migration importer, future data version policy, and real-path restrictions remain conditional requirements of the corresponding product promises.

## Evidence scripts and reproduction

Surviving historical artifacts are `/tmp/rowbly-perf/gen.mjs`, `bench.sh`, `destructive.sh`, `microbench.mts`, `count-reads.mjs`, `epic-list.mts`, `results-corrected.txt`, and `epic-result.txt`. These are not repository deliverables and `/tmp` is ephemeral. The reproducible script bodies are embedded below so evidence survives with this one assigned file. The original generator body is corrected in the embedded copy to include required Board timestamps; no surviving script was changed in this pass.

Reproduction is deliberately separate from the supervisor's required tests. It writes only generated roots under a fresh temporary directory and mutation commands affect only those roots. Do not run the historical destructive script against real data. Initial-fixture doctor should have no findings; a nonzero exit invalidates a timing. Recreate a fixture before rerunning measurements: the prior fixture has had `common.md` deleted and its links removed.

### Commands

Save the following blocks into temporary files with the indicated names. From the repository root, use an already current `dist/cli.js` (the supervisor may build it once as part of validation). No dependency install is needed. The historical TypeScript scripts contain this checkout's absolute path; replace it when using another checkout. A temporary `node_modules` symlink to the repository is needed for the historical microbenchmark's bare `zod` import; it is unnecessary for the Epic-loading script's absolute imports. Only use a newly created temporary folder when creating that link.

```sh
# Example future reproduction; not executed in this report pass.
review_tmp=$(mktemp -d /tmp/rowbly-plugin-review.XXXXXX)
# Save gen.mjs/bench.sh/count-reads.mjs/epic-list.mts/microbench.mts below here.
node "$review_tmp/gen.mjs" 5000 "$review_tmp/data"
node dist/cli.js --root "$review_tmp/data/on" doctor --json
CLI="$PWD/dist/cli.js" bash "$review_tmp/bench.sh" "$review_tmp/data"
node --import "$review_tmp/count-reads.mjs" dist/cli.js --root "$review_tmp/data/on" doctor --json
# For the exact historical source scripts: update their root path to this new fixture.
# Run before mutating the common Spec; choose a fresh fixture for each experiment.
pnpm exec tsx "$review_tmp/epic-list.mts"
ln -s "$PWD/node_modules" "$review_tmp/node_modules"
pnpm exec tsx "$review_tmp/microbench.mts"
node dist/cli.js --root "$review_tmp/data/on" specs delete common --board web --yes
```

The benchmark block below is a read-only, exit-checked reproduction aid replacing the historical shell script's mixed read/mutation timing. For the exact prior command sequence, see `results-corrected.txt` and the table above. Single unlink timing can be measured with `performance.now`/a child process or `/usr/bin/time`; no requirement to adopt that shell utility as a project dependency.

<!-- Embedded evidence scripts follow. -->

### gen.mjs — corrected historical fixture generator

```js
// Generates a Data Root with 1 Board and N Stories, 50 Epics, 20 Board Specs (+ 'common'), 2 Comments per Story.
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const N = Number(process.argv[2] ?? 5000);
const out = process.argv[3];
const ts = '2026-10-12T17:21:07.000Z';
const root = join(out, 'on');
mkdirSync(join(root, 'boards/web/stories'), { recursive: true });
mkdirSync(join(root, 'plugins/epics'), { recursive: true });
mkdirSync(join(root, 'boards/web/plugins/specs'), { recursive: true });
writeFileSync(
  join(root, 'rowbly.config.json'),
  JSON.stringify(
    {
      version: 1,
      assignees: [{ handle: 'alice', name: 'Alice' }],
      plugins: { epics: { enabled: true }, specs: { enabled: true }, comments: { enabled: true } },
    },
    null,
    2,
  ),
);
writeFileSync(
  join(root, 'boards/web/board.config.json'),
  JSON.stringify({ version: 1, id: 'web', name: 'Web', keyPrefix: 'WEB', description: '', createdAt: ts, updatedAt: ts }, null, 2),
);
for (let e = 0; e < 50; e++) {
  writeFileSync(
    join(root, `plugins/epics/epic-${e}.json`),
    JSON.stringify(
      { version: 1, id: `epic-${e}`, name: `Epic ${e}`, description: '', closed: e % 10 === 0, createdAt: ts, updatedAt: ts },
      null,
      2,
    ),
  );
}
for (let s = 0; s < 20; s++) writeFileSync(join(root, `boards/web/plugins/specs/spec-${s}.md`), `# Spec ${s}\n\nBody ${s}\n`);
writeFileSync(join(root, 'boards/web/plugins/specs/common.md'), '# Common\n\nShared\n');
const stages = ['backlog', 'todo', 'in-progress', 'done'];
for (let i = 1; i <= N; i++) {
  const key = `WEB-${i}`;
  const dir = join(root, 'boards/web/stories', key);
  mkdirSync(dir, { recursive: true });
  const comment = (id, author, body) => ({ id, author, body, createdAt: ts, updatedAt: ts });
  const story = {
    version: 1,
    key,
    boardId: 'web',
    name: `Story ${i}`,
    description: `Description of story ${i}. `.repeat(3),
    stage: stages[i % 4],
    rank: `a${i.toString(36).padStart(5, '0')}`,
    assignees: i % 3 === 0 ? ['alice'] : [],
    priority: i % 5 === 0 ? 'P1' : null,
    labels: i % 7 === 0 ? ['bug'] : [],
    dueDate: null,
    customFields: {},
    createdBy: null,
    createdAt: ts,
    updatedAt: ts,
    nextTaskNumber: 2,
    tasks: [
      {
        id: `${key}.1`,
        name: 'Task',
        description: '',
        stage: 'todo',
        createdAt: ts,
        updatedAt: ts,
        plugins: { comments: { comments: [comment('c1', 'alice', 'task comment')] } },
      },
    ],
    plugins: {
      epics: { epic: `epic-${i % 50}` },
      specs: { specs: [`spec-${i % 20}`, 'common'] },
      comments: { comments: [comment('a1', 'alice', 'first'), comment('a2', null, 'second')] },
    },
  };
  writeFileSync(join(dir, 'story.json'), `${JSON.stringify(story, null, 2)}\n`);
}
cpSync(root, join(out, 'off'), { recursive: true });
const cfgPath = join(out, 'off/rowbly.config.json');
const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
cfg.plugins = { epics: { enabled: false }, specs: { enabled: false }, comments: { enabled: false } };
writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
console.log('generated', N, 'stories under', out);
```

### bench.sh — read-only, exit-checked reproduction aid

This aid reports all samples and avoids modifying the fixture between read workloads. It was not executed in this pass.

```sh
#!/usr/bin/env bash
set -euo pipefail
CLI="${CLI:?Set CLI to the absolute path of the current dist/cli.js}"
python3 - "$CLI" "$1" <<'BENCH_PY'
import subprocess, sys, time
from pathlib import Path
cli, parent = sys.argv[1], Path(sys.argv[2])
cases = [
 ('stories list off', 'off', ['stories','list','--json']),
 ('stories list on', 'on', ['stories','list','--json']),
 ('Epic filter', 'on', ['stories','list','--epic','epic-1','--json']),
 ('Spec filter', 'on', ['stories','list','--spec','spec-1','--json']),
 ('Story show off', 'off', ['stories','show','WEB-100']),
 ('Story show on', 'on', ['stories','show','WEB-100']),
 ('Task show', 'on', ['tasks','show','WEB-100.1']),
 ('Epic CLI list', 'on', ['epics','list']),
 ('Epic show', 'on', ['epics','show','epic-1']),
 ('Specs list', 'on', ['specs','list','--board','web']),
 ('Comments list', 'on', ['comments','list','WEB-100']),
 ('doctor off', 'off', ['doctor']),
 ('doctor on', 'on', ['doctor']),
]
for label, mode, args in cases:
 samples=[]
 for _ in range(3):
  start=time.perf_counter()
  result=subprocess.run(['node',cli,'--root',str(parent/mode),*args],
                        stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
  elapsed=(time.perf_counter()-start)*1000
  if result.returncode:
   raise SystemExit(f'{label}: INVALID exit {result.returncode}: {result.stderr.decode()}')
  samples.append(round(elapsed,1))
 print(label, 'ms samples=', samples, 'best=', min(samples))
BENCH_PY
```

### count-reads.mjs — historical read-attempt instrumentation

```js
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
const counts = {board:0,story:0,spec:0,other:0};
const original=fs.readFile;
fs.readFile=async function(path,...args){const p=String(path);counts[p.endsWith('board.config.json')?'board':p.endsWith('story.json')?'story':p.endsWith('.md')?'spec':'other']++;return original.call(this,path,...args)};
syncBuiltinESMExports();
process.on('exit',()=>process.stderr.write(JSON.stringify(counts)+'\n'));
```

### epic-list.mts — historical Epic list loading expression

```ts
import { loadPlugins, createServices } from '/home/sgolovine/Projects/rowbly/src/services/index.ts';
import { reservedNames } from '/home/sgolovine/Projects/rowbly/src/main.ts';
import { builtInPlugins } from '/home/sgolovine/Projects/rowbly/src/plugins/index.ts';
import { listEpics,showEpic } from '/home/sgolovine/Projects/rowbly/src/plugins/epics/service.ts';
const root={path:'/tmp/rowbly-perf/data5k/on',kind:'local' as const};
const host=await loadPlugins({root,registry:builtInPlugins,reserved:reservedNames()});
const services=createServices({root,local:{version:1},me:null,now:()=>new Date(),newId:()=> '12345678',warn:console.error,plugins:host});
const plugin=services.plugins.context('epics');
const epics=await listEpics(plugin,'open');const t=performance.now();
await Promise.all(epics.map(e=>showEpic(plugin,e.id)));
console.log(`EpicList open ${epics.length} Epics: ${(performance.now()-t).toFixed(1)} ms`);
```

### microbench.mts — historical parsing, Change Set and activation benchmark

```ts
// In-process costs: zod bag parsing per Story, Change Set growth, program construction, plugin loading.
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { createProgram, reservedNames } from '/home/sgolovine/Projects/rowbly/src/main';
import { builtInPlugins } from '/home/sgolovine/Projects/rowbly/src/plugins';
import { loadPlugins } from '/home/sgolovine/Projects/rowbly/src/services';
import { CoreChangeSet } from '/home/sgolovine/Projects/rowbly/src/services/plugins/changeSet';
import { StorySchema } from '/home/sgolovine/Projects/rowbly/src/schemas';
import { createRepositories } from '/home/sgolovine/Projects/rowbly/src/storage';

const ms = (t: number) => `${(performance.now() - t).toFixed(1)} ms`;
const ts = '2026-10-12T17:21:07.000Z';
const N = 5000;

// 1. readBag-style parse of a small bag, and full StorySchema parse, per Story.
const EpicBag = z.object({ epic: z.string() });
const stories = Array.from({ length: N }, (_, i) => ({
  version: 1 as const, key: `WEB-${i + 1}`, boardId: 'web', name: `S${i}`, description: '', stage: 'todo',
  rank: `a${i}`, assignees: [], priority: null, labels: [], dueDate: null, customFields: {}, createdBy: null,
  createdAt: ts, updatedAt: ts, nextTaskNumber: 1, tasks: [], plugins: { epics: { epic: 'auth' } },
}));
let t = performance.now();
for (const s of stories) EpicBag.safeParse(s.plugins.epics);
console.log(`EpicBag.safeParse x${N}: ${ms(t)}`);
t = performance.now();
for (const s of stories) StorySchema.safeParse(s);
console.log(`StorySchema.safeParse x${N} (what readJson does per file): ${ms(t)}`);
t = performance.now();
for (const s of stories) JSON.parse(JSON.stringify(s));
console.log(`JSON round trip x${N}: ${ms(t)}`);

// 2. Change Set with N pending Story changes: putStory + updateStory lookups are linear scans.
const dir = join(tmpdir(), `rowbly-cs-${Date.now()}`);
mkdirSync(join(dir, 'boards'), { recursive: true });
writeFileSync(join(dir, 'rowbly.config.json'), JSON.stringify({ version: 1, assignees: [] }));
const root = { path: dir, kind: 'local' as const };
const repos = createRepositories(root);
const cs = new CoreChangeSet(root, repos);
t = performance.now();
for (const s of stories) await cs.putStory(s);
console.log(`CoreChangeSet.putStory x${N} (new keys, each scans pending list): ${ms(t)}`);
t = performance.now();
for (const s of stories) await cs.updateStory(s.key, (x) => ({ ...x, name: 'y' }));
console.log(`CoreChangeSet.updateStory x${N} on pending Stories: ${ms(t)}`);
t = performance.now();
for (const s of stories) cs.story(s.key);
console.log(`ChangeSetView.story(key) x${N}: ${ms(t)}`);

// 3. Program construction, done twice per CLI run (reservedNames() + createProgram(host)).
t = performance.now();
reservedNames();
console.log(`reservedNames() (builds a throwaway program): ${ms(t)}`);
t = performance.now();
createProgram();
console.log(`createProgram(): ${ms(t)}`);

// 4. Loading the Built-in Plugins against a config that turns all of them on.
const dir2 = join(tmpdir(), `rowbly-load-${Date.now()}`);
mkdirSync(dir2, { recursive: true });
writeFileSync(
  join(dir2, 'rowbly.config.json'),
  JSON.stringify({
    version: 1,
    assignees: [],
    plugins: { epics: { enabled: true }, specs: { enabled: true }, comments: { enabled: true } },
  }),
);
const reserved = reservedNames();
t = performance.now();
await loadPlugins({ root: { path: dir2, kind: 'local' }, registry: builtInPlugins, reserved });
console.log(`loadPlugins(all three on): ${ms(t)}`);
t = performance.now();
await loadPlugins({ root: { path: dir, kind: 'local' }, registry: builtInPlugins, reserved });
console.log(`loadPlugins(all off): ${ms(t)}`);
```

### results-corrected.txt and epic-result.txt — preserved historical output

```text
stories list --json (off): best 857 ms (rc=0)
stories list --json (on): best 825 ms (rc=0)
stories list --epic epic-1 --json (on): best 769 ms (rc=0)
stories list --spec spec-1 --json (on): best 811 ms (rc=0)
stories list --open --json (off): best 805 ms (rc=0)
stories show WEB-100 (off): best 222 ms (rc=0)
stories show WEB-100 (on): best 227 ms (rc=0)
tasks show WEB-100.1 (on): best 217 ms (rc=0)
epics list (on): best 237 ms (rc=0)
epics show epic-1 (on): best 841 ms (rc=0)
specs list (on): best 225 ms (rc=0)
comments list WEB-100 (on): best 224 ms (rc=0)
doctor (off): best 1311 ms (rc=0)
doctor (on): best 3208 ms (rc=0)
stories create --epic epic-1 --spec spec-1 (on): best 861 ms (rc=0)
stories move WEB-200 done (on): best 820 ms (rc=0)
stories move WEB-201 done (off): best 826 ms (rc=0)
comments add WEB-100 (on): best 219 ms (rc=0)
EpicList open 45 Epics: 21307.2 ms
```

## Ranked top ten within this review's area

This local ranking is subordinate to the supervisor's cross-review P0/P1 integrity gates and WP ownership. It deliberately puts current data loss before convenience infrastructure.

1. **VER-02:** reject mutation of invalid bags rather than authorizing an empty replacement; merge with WP01/WP04/WP05/WP08 preservation work.
2. **UI-01:** make forceable Board deletion available in TUI without bypassing arbitrary guards.
3. **PERF-01:** replace per-Epic whole-root reads with one summary snapshot.
4. **PERF-02:** deduplicate Specs doctor checks by Board/document.
5. **PERF-03:** index Change Set lookups under the corrected identity/transaction contract; WP02 owns it.
6. **PERF-04:** avoid rereading before-records during first Story/Board updates.
7. **DOC-01 / DOC-02:** correct active contracts and distinguish built/planned/historical ADR status.
8. **OBS-02:** attribute errors consistently while retaining domain error codes.
9. **TEST-01 / TEST-02 / TEST-04:** document isolation, consolidate production-like warning wiring, and cover concrete parity gaps. Include UI-02's whitespace regression.
10. **VER-03:** settle/document legacy-data support and add targeted diagnostics if supported. Do not silently reverse the accepted no-migration decision.

PERF-08, PERF-09 and UI-02 are small local changes suitable for the already assigned Specs/Comments workers. TEST-03, PERF-06, DOC-03/04/05 and small OBS-01/03 improvements can follow without blocking integrity fixes. PERF-05, BUILD-01, external VER-01 policy, SEC-01/02, GIT-01 and DEP-01 remain conditional/deferred as described above; SEC-03 aligns with WP04's command-context editor restriction now.

## Good foundations to keep

- Service-layer integration gives CLI and TUI one mutation pipeline instead of independent hook systems.
- Replacement/core → transforms → guards → save → reactions is explicit and tested (`test/plugins/pipeline.test.ts:38`); preserve its intent while enforcing stage permissions.
- Registry order and namespaced Plugin input/data are straightforward. Do not replace them with a generic event bus for the current three built-ins.
- Plugin TUI modules are lazy; main API type-only React/Commander references do not import their runtime packages by themselves.
- Opaque bags of disabled/unknown Plugins are retained by core schemas and tested (`test/plugins/bags.test.ts:51`). Strengthen invalid-data preservation without stripping that property.
- Plugin files live beside owners and whole-folder moves retain them; this remains the right model even though commit/recovery needs stronger guarantees.
- Relative-name checks prevent basic traversal. Keep them alongside any physical-containment policy; they are not a sandbox.
- Existing pipeline attribution, reaction/row warnings, list/show status/reasons, invalid-bag doctor checks, and unchecked-data summaries are useful starting points, not missing systems.
- Contextual glossaries, the context map, architectural import checks, and vocabulary tests protect coherent boundaries (`test/architecture.test.ts:111`, `test/e2e/language.test.ts:30`). Treat import checks as maintainability enforcement, not hostile-code confinement.
- The isolated-registry fixture helpers, deterministic clocks/ids, compiled CLI fixtures, `waitForFrame`, and keyboard interaction tests already give substantial coverage. Preserve that investment rather than inventing a new testing framework.
- PLUGINS already explains the built-in authoring model in detail. Correct and extend it with one runnable example and precise lifecycle semantics.
- The project is still compact enough for targeted fixes. Proposed helpers should remove proven repetition; public abstractions should follow real consumers.
