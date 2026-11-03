# Story opening performance diagnosis and fix plan

Investigated 2026-11-02 against Rowbly 0.11.0, source revision `1e10f283`. Investigation only; no application changes implemented.

## Finding

The bottleneck is coordinated filesystem access and the work required before Story details can appear. Fuzzy matching took 2.66 ms for 70 Stories. The details loader performs 11 separate coordinated reads for the enabled Plugins in this Data Root, each taking a Git publication gate and a Data Root lock. These acquisitions create and fsync 22 lock temporary files. A busy publication gate can block even the initial single-Story read for seconds. Slow storage amplifies the repeated acquisitions.

The quiet baseline did not reproduce a spontaneous multi-second pause: details loaded in 15–16 ms. Controlled experiments reproduced both the lock-wait mechanism and sensitivity to storage latency. These establish plausible, measurable causes, but do not identify which holder or storage event caused the user's original intermittent incident. Capture wait/hold timing during a real occurrence to attribute it conclusively.

## Method and measurements

A temporary copy of the repository's Data Root contained 70 Stories and the enabled Tasks, Epics, Specs, Comments, Attachments, Story Linking, Git and Software Factory Plugins. The copy was placed in a newly initialized Git repository to exercise the real publication gate. The harness loaded the real Plugin registry and invoked the same service sequence as the Story details loader. It did not start the full TUI, Git synchronization, or its background reloads.

Measurements exclude application startup and React/Ink rendering. Baseline measurements ran before validation jobs. The latency experiment ran on a shared machine and includes scheduler variation. Instrumentation counted storage `io` operations; JSON reads use a separate helper, so these counts are lock counts, not a complete inventory of filesystem reads.

- Finder index construction: 154.82 ms, 102 coordinated acquisitions and 204 fsynced lock temporary files.
- In-memory fuzzy match for `ROW-48`: 2.66 ms, no filesystem operations.
- Details loader, three baseline runs: 15.55, 15.33 and 16.34 ms; 11 acquisitions and 22 lock temporary files per run.
- Story Linking detail rows alone: 9.19 ms; two acquisitions, including a full same-Board Story list. This was the largest individual row callback measured.
- Identical details service sequence inside one existing `coordinated` scope: 8.54 ms; one acquisition and two lock temporary files.
- Injected 50 ms delay before each lock temporary-file write: current details sequence 1,207.04 ms; the single coordinated scope 123.48 ms. This is synthetic storage latency, not a measurement of the user's disk.
- The same injected latency made finder index construction take 11,072.23 ms. This is a separate delay before results are available, not time after selecting a ready result.
- A publication gate deliberately held for two seconds made `stories.get` take 2,004.02 ms.
- Selecting the already-current Board through `context.use` still executed a mutation: 11.55 ms in the isolated copy. This number is separate from the details measurements.

Reproduce from this checkout with `pnpm exec tsx /home/sgolovine/Reports/rowbly-story-opening-performance-2026-11-02/profile.mts`. The harness retains a temporary Data Root and prints its path; it does not mutate the original Data Root. Raw output is in `measurements.jsonl` alongside this report.

## Why it happens

### Selection does work before navigation

`src/tui/shell/Shell.tsx:480` validates the result with `stories.get`, always awaits `context.use`, increments the Board version, resets the Board route and pushes the Story route. Even a same-Board selection writes Local State through the operation/transaction pipeline. This adds write latency and can initiate background reactions and watcher-driven reloads.

The Board screen stays mounted underneath the Story (`src/tui/shell/ScreenSlot.tsx`). Incrementing its selection version causes its scope to reload; that scope reads filters and `storyChoices`, which reads all Stories for Labels, then triggers another Story list and badge load (`src/tui/screens/board/BoardScreen.tsx:110`). Sidebar reloads also follow Board version and route depth. These jobs can contend with the new details loader. Their precise contribution was established by source tracing, not end-to-end timing in this investigation.

### Optional content blocks all Story details

`src/tui/screens/stories/StoryDetailScreen.tsx:58` serially awaits Story, effective config, all Plugin rows, and badge loading. It renders only Loading until the entire result exists. The rows themselves are awaited in registry order (`src/services/plugins/service.ts`). A slow optional row or badge delays the Story name, description and core actions.

Story Linking's `readLinks` rereads the target Story and lists every Story on its Board to discover incoming relationships (`src/plugins/story-linking/links.ts`). Epics badge loading lists and reads every Epic file, each via a separately coordinated Plugin file call (`src/plugins/epics/epicFile.ts:112`). This expands work beyond the one Story being opened.

### Each read pays durable coordination overhead

`createServices` wraps service methods in `coordinatedServices`; Plugin file reads/listing also coordinate individually (`src/services/plugins/runtime.ts`). `lockAndRecover` first enters the Git publication gate, then acquires the Data Root lock and runs recovery (`src/services/coordination.ts`). `createExclusive` writes and fsyncs a private temporary file before linking each lock into place (`src/storage/lock.ts`; `io.writeFile` calls `handle.sync`). This happens on reads as well as mutations.

Thus 11 small logical reads become 22 durable lock-file writes. Concurrent `Promise.all` at the screen level does not remove the shared exclusive lock; independent calls still queue. A publication journal/owner may also route acquisition through worker recovery. Repository discovery is cached for a Git-backed Data Root, so repeated `git rev-parse` is not the established cause here. Normal fetch/push is prepared outside the publication critical section; do not attribute all network time to the publication gate.

### Search indexing has a related amplification

`src/tui/shell/storySearch.ts:19` rebuilds the index for every finder mount. It walks Stories sequentially and asks Plugins for search text. Specs reads Story Specs and linked Board Specs; Epics reads linked Epic content. Repeated coordinated file calls explain the 102 acquisitions in this Data Root. Searching the resulting strings is cheap.

## Proposed implementation

1. Instrument coordination first. Record queue wait, publication-gate wait, Data Root lock wait, recovery duration and held-work duration separately, with operation names and durations only. Existing `ROWBLY_DEBUG=trace` callback/operation timing does not isolate all these waits. Capture the actual slow opening and its competing holder.
2. Skip `context.use` and Board-version invalidation when the selected Story is already on the current Board. Preserve the result existence check and cross-Board selection behavior. Avoid resetting/reloading the covered Board solely to open a same-Board Story.
3. Render fresh core Story/config data as soon as available; load optional rows/badges separately with explicit pending state. Preserve error handling and freshness when changing Story or returning from an edit. Keep visible key hints consistent with accepted input.
4. Batch bounded related reads under one service-layer coordinated snapshot using the existing reentrant coordinator. The harness demonstrates an 11-to-1 reduction in acquisitions without weakening either lock. Avoid holding this snapshot through arbitrary slow third-party callbacks; move known Built-in Plugin reads into bounded loaders or keep optional work outside the core path. Account for longer lock holds and mutation fairness.
5. Reuse the supplied Story/config where appropriate, and avoid repeated same-Board scans. For Story Linking, use a request-scoped Board snapshot initially; introduce a properly invalidated relationship index only if larger-Board measurements justify it. Preserve incoming links and invalid-bag warnings.
6. Batch Epic reads and deduplicate Spec/Epic search content within an index build. Cache the finder index only with explicit invalidation on Data Root, Board/scope, Plugin and content changes. Do not hold an exclusive lock over an unbounded full-Data-Root index build.

Retain ADR-0019 lock/recovery guarantees and Git publication safety. Do not remove fsync, bypass locks or serve unvalidated stale data as the fix. Any change to an accepted decision requires an amending ADR.

## Acceptance and verification

- Record selection-to-core-details and selection-to-enrichment timing separately, plus index construction time. Compare same-Board and cross-Board opens, few/many Stories, and Specs/Epics/Story Linking on/off.
- Same-Board selection performs no Local State mutation and no unnecessary covered Board reload.
- Core Story content becomes usable without waiting for optional Plugin work once its own required read has completed. A genuine publication lock hold can still delay fresh core reads and must be visible in diagnostics.
- For this representative Plugin setup, bounded details batching substantially reduces 11 acquisitions; retain the demonstrated snapshot experiment as the comparison, not a promise that the final UI must use one lock for every Plugin.
- Exercise slow optional callbacks and a controlled publication hold using barriers if code changes touch coordination/races; preserve atomic old-or-new reads and recovery. Extend existing test homes only where repository test rules require it. Use the manual benchmark for performance figures, not brittle timing assertions.
- Verify externally changed Stories, deleted search results, cross-Board opening, optional Plugin failures, and return-from-edit freshness. Use the documented agentic-tui workflow for actual TUI validation/screenshots.

## Repository checks

`pnpm typecheck`: passed. `pnpm lint`: passed. `pnpm test:unit`: 78 passed. `pnpm test:cli`: 20 passed. No tests or application source were added or changed for this investigation.