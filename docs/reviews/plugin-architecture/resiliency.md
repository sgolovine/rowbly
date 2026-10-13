# Plugin architecture review: resiliency and correctness under failure

Reviewed on 2026-10-13 against commit `5b3acd475968ad5577bdb0a2008f7f46be3639de`. This report preserves the previous RES-01–RES-19 identifiers and adds identifiers for smaller issues previously left in prose. Paths and line numbers refer to this source snapshot.

## Scope, evidence, and corrections

The review covers the operation runner and Change Set, plugin loading and registrations, built-in plugin data, doctor, CLI error handling, and TUI failure isolation. Source was not changed. Only this assigned report was added to the repository by this reviewer. Reproduction scripts and fresh output are retained under `/tmp/rowbly-review/`; they use temporary Data Roots and import the current repository source. The supervisor archived the scripts in [repros/](repros/README.md); durable script links are in the evidence inventory below. This reviewer did not modify that archive.

The [consolidated execution plan](README.md) was read for conflict checking and was not edited. Its work-package priorities and ownership decisions supersede alternative local recommendations here. In particular, its chosen logical file scope design resolves the alternatives in RES-10, and its P1 lifecycle/freshness gates cover RES-15/19 even though those were initially classified as useful improvements for the first current built-ins. RES-20/23 belong to WP05, RES-22/25 to WP06, RES-24 to WP02, and RES-21 to WP02's agreed filesystem policy. There is no material disagreement with the P0 design.

No `pnpm test`, typecheck, or lint run was performed during this follow-up. In the earlier review, typecheck, lint, and the suite passed: 66 files and 610 tests. That historical pass is evidence of existing normal-path coverage, not evidence that the failure cases below are safe. The supervisor owns the final check run.

Evidence labels:

- **CONFIRMED:** executed the stated reproduction against current source. A helper-level reproduction is explicitly identified; it does not imply an end-to-end CLI or TUI test.
- **INFERRED:** the source establishes the exposure, but the application failure was not reproduced. No inferred issue is presented as a measured crash or data loss.
- **Release blocker:** fix before shipping the supported plugin/data workflow, or explicitly narrow the supported contract and enforce that narrower contract.
- **Useful improvement:** concrete behavior worth fixing, but not a reason to invent a larger framework or automatically hold the first built-in-plugin release.
- **Optional abstraction:** a possible future design, not an implementation requirement for this release.

Corrections to the previous report:

1. RES-02 reproduces two independent service/repository instances in one process. The equivalent two-process race follows from the absence of any lock, but a two-CLI-process run was not performed. Add that as the regression test.
2. RES-04 leaves recoverable bytes in `.xxxxxxxx.moving`; the reproduced outcome is an inaccessible Story and unsafe key reuse, not proof that all bytes were erased. The interrupted state was also simulated manually; a real process kill was not performed.
3. RES-10 is a direct `CoreChangeSet` reproduction. Existing built-in doctor hooks normally enqueue files after core renumbering has been collected. Do not claim the current built-ins routinely trigger its specific ordering.
4. RES-11 reproduces the actual field/input functions followed by the service call. It does not automate keyboard submission through Ink. A fresh reproduction also confirms destructive replacement of an invalid Comments bag on `addComment`.
5. RES-13 confirms that the actual screen boundary rethrows an ordinary error. A whole Ink application's fatal lifecycle was not exercised. The precise end-to-end outcome remains inferred.
6. RES-15 does not always hang the process. A pending operation remains unresolved; Node can exit 13 for unsettled top-level await if nothing keeps the event loop alive. A live handle can instead keep it waiting.
7. RES-18 combines three different exposures. A synchronous `useAsync` throw has a small direct fix; static built-in import failure is a build/startup containment choice; arbitrary detached async execution cannot be made safe by another `try/catch`. Worker isolation is optional, not a release prerequisite.
8. `readBag` returning `undefined` for invalid data is documented behavior. The bug is treating that result as permission to overwrite stored data. Object-valued bags belonging to other plugins are preserved semantically; JSON whitespace and ordering are not promised byte-for-byte.
9. A throwing doctor fix aborting the current pass before any save is consistent with ADR-0012. It is a tested/reproduced safety property, not an isolation defect to “fix” by continuing with partial mutations.
10. Symlink escape is a confirmed filesystem-capability weakness, not proof of an adversarial third-party plugin sandbox escape. Third-party plugins are outside this build's scope.
11. The consolidated WP05 acceptance phrase “byte-equivalent raw bags” should mean unchanged JSON values, including unknown fields, not preservation of source whitespace or the exact JSON substring. Current record serialization normalizes JSON; preserving file-format bytes would add an unrequested storage requirement.

## Ranked release priorities

| Rank | ID | Failure to eliminate | Primary owner |
| --- | --- | --- | --- |
| 1 | RES-01 | Multi-record saves leave partial state on failure | Storage/transaction |
| 2 | RES-02 | Concurrent creates/updates overwrite successful operations | Storage/runtime |
| 3 | RES-06 | Exposed snapshots redirect deletion and bypass validation | Change Set/API |
| 4 | RES-09 | Doctor removes data from the wrong duplicate-key Story | Doctor |
| 5 | RES-03 | A failed plugin text write truncates the original file | Storage |
| 6 | RES-04 | Folder move failure hides Stories and permits key reuse | Storage/doctor |
| 7 | RES-11 | Invalid bags are silently overwritten by ordinary edits | Built-ins/forms |
| 8 | RES-05 | Nested handler operations independently save and lose data | Runtime/API |
| 9 | RES-07 / RES-08 | Orphan/deleted folders donate plugin data to new Stories | Storage/Change Set |
| 10 | RES-12 / RES-13 / RES-14 | Plugin failures disable core UI or abort CLI construction | UI/loading |

This ranking is about consequences, not patch order. Storage work has shared dependencies and should have one implementation owner. RES-16/17/20/23/25 are small fixes worth retaining even though they are not data-loss release blockers.

## Findings

### <a id="res-01"></a>RES-01 — A Change Set can commit only part of an operation

**Severity:** critical. **Status:** CONFIRMED. **Disposition:** release blocker.

**Source:** `src/services/plugins/changeSet.ts:165` builds moves; `:175` performs them before record writes; `:177` saves changes sequentially. `src/storage/jsonStore.ts:48` validates and atomically replaces only one JSON file.

**Trigger and reproduction:** Run `r03-partial-save.ts` using the command in the evidence appendix. Case A seeds three Stories assigned to `bob`; a transform makes the second Story's name invalid during `assignees.remove`. Case B deletes an Epic linked to three Stories after making WEB-2's folder read-only.

**Observed:** Case A throws `ValidationError` but the root roster has already removed `bob` and WEB-1 has removed him; WEB-2/3 still reference him. Case B throws `EACCES`, WEB-1 is unlinked, WEB-2/3 remain linked, and the Epic file remains. There is no operation-level rollback/recovery. The permission fixture requires a non-root process; it succeeded in this environment. A root-run regression should use fault injection rather than chmod.

**Recommended change:** First prevalidate/serialize every final record and file before touching live paths. Then implement a small recoverable transaction for this application's actual primitives: record replacement, plugin file replacement/removal, Story folder renumbering, and Story/Board folder deletion. Stage content and recoverable deletion targets, record an on-disk manifest before live mutation, and choose one explicit recovery policy: roll forward a prepared transaction, or restore originals for an uncommitted transaction. Recovery must be idempotent and run before normal repository access. No database migration or general transaction DSL is required.

Do not describe sequential renames as an instantaneous multi-file atomic filesystem operation. The achievable contract is consistent state after recovery and consistent views for cooperating Rowbly operations, using RES-02's coordination. Raw external tools can still observe intermediate states or modify files; document that limit. Keep filesystem error diagnostics and do not report “nothing saved” when recovery itself fails.

**Acceptance/tests:** Add `test/plugins/transactionFailure.test.ts`. Inject failure at each write/move/delete step of assignee removal and Epic/Spec deletion; reopen services and recover; assert all old or all new relationships and files. Add subprocess termination at durable transaction checkpoints. Recovery interrupted a second time remains safe. Invalid final records cause zero live writes. Journal artifacts are recognized by doctor and excluded from Git data where appropriate. Preserve one guarded operation for each normal user action.

**Dependencies/ownership:** Storage owner coordinates RES-02/03/04/08/10. Change Set owner supplies an immutable, validated final plan from RES-06. Do not let separate agents introduce incompatible journals or duplicate commit mechanisms.

### <a id="res-02"></a>RES-02 — Independent operations can both succeed while one is lost

**Severity:** critical. **Status:** CONFIRMED for two service instances; two-process consequence INFERRED. **Disposition:** release blocker.

**Source:** `src/services/plugins/runtime.ts:66` starts an independent Change Set without coordination; `src/services/stories.ts:134` reads existing Stories and `:138` allocates a key; `src/storage/repositories.ts:141` derives the next number from disk.

**Trigger/reproduction:** `r01-concurrent-create.ts` creates two independent service instances over one root and calls `stories.create` concurrently with names “From A” and “From B”.

**Observed:** Both calls return WEB-1; disk has one WEB-1 folder, and the final Story is “From B”. This is silent loss after successful API calls. Individual atomic file replacement does not serialize the read/modify/write operation.

**Recommended change:** Serialize cooperating mutating operations per canonical Data Root across both processes and service instances. Acquire coordination before any state used to plan the operation is read, not just during `save()` or even just at body entry. In particular, `doctor.fix` currently analyzes at `src/services/doctor.ts:600` before `ops.run`; that snapshot must be planned inside coordination or revalidated/rebuilt after acquisition. Audit stale context snapshots as well as disk reads. Use a bounded wait and a documented stale-owner recovery rule for the lock. Keep mutation coordination through commit/recovery; release before reactions, which operate outside Rowbly data. Read paths must avoid observing unrecovered/partially committed transactions if RES-01 promises that property. Reuse an already-held coordination context for internal reads; reject nested mutations under RES-05 rather than deadlocking them.

**Acceptance/tests:** `test/plugins/concurrency.test.ts`: two actual CLI subprocesses produce distinct Story keys and retain both Stories. Concurrent edits to different fields must serialize from the latest saved record or reject a stale operation explicitly. Cover plugin file create/edit and root config changes too, plus a doctor snapshot competing with a Story update. A terminated lock owner cannot block the root forever. A lock around save alone, or around application of an already stale plan, must fail the regression.

**Dependencies/ownership:** Storage/runtime owner; overlaps every mutating service and RES-01. Resolve RES-05 before enabling a non-reentrant lock. External manual edits and Git writes are not silently covered by a Rowbly-only lock.

### <a id="res-03"></a>RES-03 — A failed text write destroys the original plugin file

**Severity:** critical. **Status:** CONFIRMED. **Disposition:** release blocker.

**Source:** `src/services/plugins/changeSet.ts:198` invokes `writeTextFile`; `src/storage/system.ts:32` creates parents and `:34` writes directly to the destination with `writeFile`.

**Trigger/reproduction:** `text-failure.ts` creates a 30,000-byte existing Spec, then runs the actual helper in a Bash subprocess with `ulimit -f 2`, attempting a 300,000-byte replacement.

**Observed:** `EFBIG` from `system.ts:34`, subprocess status 1, and the destination is now 2,048 bytes. Old content was truncated before failure. This also affects JSON serialized as plugin text, including Epic files.

**Recommended change:** Write plugin text to a unique same-directory temporary file, then rename over the destination only after a complete write. Clean up staging files on handled errors. Integrate this with RES-01's staging so multiple files share one transaction. Specify whether durability covers process death only or power failure; if the latter is promised, synchronize file/directory changes as needed for the supported filesystem.

**Acceptance/tests:** `test/storage/textAtomicity.test.ts`: injected short/failed write preserves the entire original byte string, including final newline; success replaces the whole file; staging cleanup does not mask the original error. Include one subprocess resource-limit test on supported Unix platforms, with a platform guard.

**Dependencies/ownership:** Storage owner. Can be an immediate patch, but it does not solve RES-01 by itself.

### <a id="res-04"></a>RES-04 — Folder staging failures make Stories inaccessible

**Severity:** critical because normal access and key allocation lose track of existing data. **Status:** CONFIRMED; real kill/power-failure recovery untested. **Disposition:** release blocker.

**Source:** `src/storage/files.ts:47` stages sources under random `.moving` names and `:56` renames them to destinations without preflight, rollback, or journal. `src/storage/repositories.ts:115` ignores names outside Story Key syntax. `src/services/doctor.ts:182` labels the staged record as informational `UNKNOWN_FILE`.

**Trigger/reproductions:** `r04-renumber-stray-folder.ts` has a duplicate Story requiring WEB-8, whose folder already holds a Spec but no `story.json`. `r14-moving-folder.ts` manually simulates interruption after staging WEB-2 into `.ab12cd34.moving`.

**Observed:** Destination rename throws `ENOTEMPTY`, leaving the complete Story in `.xxxxxxxx.moving`; normal lists show only the keeper. In the simulated interrupted state, doctor reports only `UNKNOWN_FILE`, and create reuses WEB-2. Bytes remain in the staged folder, so describe this as inaccessible/recoverable data rather than proven byte erasure.

**Recommended change:** Preflight destinations against the complete move set before staging. An occupied destination is acceptable only if that exact destination is a source being moved away in the same valid plan. Otherwise fail before touching sources. Record original/staged/final paths durably and recover interrupted moves through RES-01. Doctor should recognize abandoned staging as an integrity problem with recovery guidance, not ignore it. Do not automatically rename arbitrary unknown folders without validated provenance.

**Acceptance/tests:** `test/plugins/moveRecovery.test.ts`: occupied target, failure staging the second source, failure placing the second destination, successful swaps, and process termination after each phase. All Stories and descendant files remain accessible after recovery. No collision silently adopts/overwrites target plugin files. Interrupted transactions reserve their keys until recovery.

**Dependencies/ownership:** Storage/doctor owner with RES-01/07. Folder-move errors after moves but before rewritten `story.json` are also covered by the transaction plan.

### <a id="res-05"></a>RES-05 — Reentrant handler mutations save independently and overwrite each other

**Severity:** critical. **Status:** CONFIRMED. **Disposition:** release blocker for the documented single-Change-Set contract.

**Source:** `src/services/plugins/runtime.ts:66` creates a new Change Set on every call; `:202` exposes mutating core services; `:205` exposes new plugin operations. `docs/PLUGINS.md:217` explicitly says not to call core operations from a handler.

**Trigger/reproduction:** `r02-reentrancy.ts`. A Story update transform calls another Story update to set `description: 'from-hook'`. A second fixture recursively calls `boards.update`, stopping itself at depth 51.

**Observed:** The nested update saves, but the outer update restores the original empty description. Recursive mutations are not rejected; only the fixture's own error stops them. No unlimited recursion or out-of-memory failure was attempted.

**Recommended change:** Track the active operation stage in the async call context. Reject a new mutating operation invoked from a guard, transform, replacement, reaction, or an already-running plugin operation body; name the originating plugin and direct it to the current Change Set. Read-only services remain usable. Top-level CLI/TUI actions can still invoke operations normally. A replacement's provided `core()` executes the existing body against the same Change Set and must remain allowed. Avoid a global boolean that incorrectly rejects unrelated concurrent requests.

**Acceptance/tests:** `test/plugins/reentrancy.test.ts`: nested mutation fails before disk writes, outer failure leaves disk unchanged, recursive handler stops at the first nested call, reads remain available, and replacement `core()` retains current behavior and error codes. Check the reaction restriction separately: it must not mutate Rowbly data after commit.

**Dependencies/ownership:** Runtime/API owner; prerequisite for RES-02 locking. Coordinate service call classification with the API reviewer rather than introducing a second facade hierarchy.

### <a id="res-06"></a>RES-06 — Change Set views expose mutable internal state and source identities

**Severity:** critical. **Status:** CONFIRMED. **Disposition:** release blocker.

**Source:** `src/services/plugins/changeSet.ts:52`, `:56`, and `:156` expose the actual list/change objects. `:192` trusts mutable `before` as the deletion target. `src/services/plugins/types.ts:92` makes the array readonly but not its elements/deep contents.

**Trigger/reproductions:** `extra.ts` changes `changes.story('WEB-1').before.key` to WEB-2 in a remove transform. `r03-partial-save.ts` case A makes an `after` invalid; case C casts and appends a raw `file` change with a traversal path.

**Observed:** Removing WEB-1 instead deletes WEB-2 and leaves WEB-1. The raw appended change writes `hijacked.txt` at the Data Root. The invalid `after` is rejected only when its own save is reached, after preceding writes. The array-push repro deliberately bypasses TypeScript; mutation of nested record fields is also allowed by the exposed types.

**Recommended change:** Keep the internal plan and original source paths private. Public views must return detached read-only snapshots; deeply freeze them or otherwise prevent mutations from reaching the plan. Expose current snapshots through accessors so the active handler's facade sees valid later Change Set updates. Give update callbacks copies too, so a callback that mutates then throws cannot poison pending internal state. Change public view types to reflect deep immutability. Guards/reactions receive only read views. Give transform mutation handles a stage lifetime: a retained handle must stop working when its handler finishes, not merely after the eventual save. Validate the final plan before any save and stop accepting mutations after preparation/abort. Keep transform methods as the supported mutation mechanism.

**Acceptance/tests:** `test/plugins/changeSetIsolation.test.ts`: modifying/pushing view objects cannot alter disk targets or other hooks' views. An update callback that throws after in-place modification leaves the pending record intact. Earlier snapshots' `before` remain the original record. A retained transform mutator cannot change the plan from a later guard, reaction, or continuation, or after sealing. Reactions receive stable saved snapshots; returned results agree with committed data.

**Dependencies/ownership:** Change Set/API owner; overlaps RES-01/08/10/15. This is accidental-mutation protection, not a security sandbox for arbitrary trusted JavaScript.

### <a id="res-07"></a>RES-07 — Orphan folders donate plugin files to newly created Stories

**Severity:** major. **Status:** CONFIRMED. **Disposition:** release blocker for data identity correctness.

**Source:** `src/storage/repositories.ts:117` omits folders without `story.json`; `:143` uses the resulting keys for allocation. `src/services/doctor.ts:169` recognizes Story plugin paths without verifying that the owner exists.

**Trigger/reproduction:** `r05-orphan-adoption.ts` seeds WEB-1's Spec under its folder with no Story JSON, then creates a Story with Specs enabled.

**Observed:** Doctor has no findings; create returns WEB-1; the new Story reads the old deleted Story's Spec.

**Recommended change:** Treat occupied valid Story folder names as reserved during allocation even when the record is absent. Keep normal Story listing strict, but report plugin-bearing orphan Story/Board folders explicitly in doctor. Require an explicit recovery/removal decision rather than attaching content to a different record. Doctor allocation must apply the same reservation rule.

**Acceptance/tests:** `test/plugins/orphanFolders.test.ts`: create skips an occupied orphan key; doctor identifies the ownerless path; old plugin files remain untouched; a subsequent healthy Story has none of that data. Include disabled/unknown plugins and Board folders with files but no config.

**Dependencies/ownership:** Storage/doctor owner; RES-04 and RES-08 contribute orphan states. Reserving a folder is sufficient; a permanent tombstone subsystem is not required for this specific failure.

### <a id="res-08"></a>RES-08 — A file write can recreate the folder of a deleted owner

**Severity:** major. **Status:** CONFIRMED. **Disposition:** release blocker for deletion semantics.

**Source:** `src/services/plugins/changeSet.ts:243` turns a pending deletion into `null`; `:256` falls back to disk; `:189` deletes the Story before `:198` recreates parents for a file write.

**Trigger/reproduction:** `extra.ts` hooks `stories.remove` and queues `writeFile({ story: 'WEB-1' }, 'left.txt', 'left')`.

**Observed:** Remove succeeds, leaving a plugin-only WEB-1 folder. A subsequent create reuses WEB-1 and reads `left.txt`. The printed root-scope file list is empty because it does not recursively list all Story scopes; that line is not evidence that the file disappeared.

**Recommended change:** Preserve a tri-state scope lookup: absent from plan, present, or deleted. Reject writes to a finally deleted Story/Board, and normalize/validate parent deletion plus descendant file changes before committing. Define reads/deletes consistently; reading a file's original content for a cleanup calculation need not imply permission to resurrect its owner. A file write queued before the parent is subsequently deleted must also be rejected or discarded under an explicit rule.

**Acceptance/tests:** `test/plugins/deletedScopes.test.ts`: write-before-delete and write-after-delete for Story and Board cannot recreate owner folders. No operation reports success with contradictory final state. Parent deletion still removes all stored files, including files of disabled plugins.

**Dependencies/ownership:** Change Set/storage owner; shared scope changes with RES-10/24 and orphan protection RES-07.

### <a id="res-09"></a>RES-09 — Doctor's pre-renumber plugin fix edits the keeper instead of the duplicate

**Severity:** critical. **Status:** CONFIRMED. **Disposition:** release blocker.

**Source:** `src/services/doctor.ts:536` generates plugin fix closures from the analyzed records; `:606` applies core fixes; `:609` flushes their new identities; `:612` executes the old closures. `src/plugins/epics/index.ts:74` targets its closed-over Story key. `src/services/plugins/changeSet.ts:210` matches updates by the current key.

**Trigger/reproduction:** `r06-doctor-stale-key.ts`: keeper WEB-1 links to existing Epic `real`; a later duplicate with key WEB-1 lives in WEB-7 and links to nonexistent Epic `gone`.

**Observed:** Doctor renumbers the duplicate to WEB-8 but applies the stale missing-Epic fix to WEB-1. The keeper loses its valid link. Another pass unlinks WEB-8 too, and final findings are empty. The initial plugin finding path also identifies WEB-1, not the duplicate's actual WEB-7 folder.

**Recommended change:** Do not execute key-addressed plugin fixes based on records about to change identity. The bounded solution is to repair structural key/path conflicts first through a guarded doctor operation, then reanalyze before generating/applying plugin fixes. Explicitly separate or defer findings associated with ambiguous duplicates. Preserve the guarantee that a thrown fix aborts its current unsaved pass; do not continue with its partially changed Change Set. Stable persistent record IDs are an alternative only if another accepted design already requires them, not a prerequisite for this fix.

**Acceptance/tests:** `test/plugins/doctorIdentity.test.ts`: keeper retains its valid Epic/Spec bag, renumbered duplicate receives only its own repair, and diagnostic paths name actual owner files. Structural guards still run; stopped/failed passes report already committed earlier passes accurately. Cover two different duplicate groups and missing links together.

**Dependencies/ownership:** Doctor owner; overlaps the API review of fix targeting and RES-01/04/17. One owner should change doctor pass ordering and its tests.

### <a id="res-10"></a>RES-10 — Already-queued plugin file paths remain under an old Story key

**Severity:** major for the supported ordering; **Status:** CONFIRMED at the Change Set helper level. **Disposition:** useful improvement / release requirement if this ordering remains a supported API capability.

**Source:** `src/services/plugins/changeSet.ts:223` resolves a scope immediately; `:233` stores only the physical path; `:175` moves Story folders; `:196` later uses the original path.

**Trigger/reproduction:** `move-file.ts` uses core `CoreChangeSet`: queue WEB-1's `note.txt`, then `recordStory(before, { ...before, key: 'WEB-2' })`, then save.

**Observed:** Both WEB-1 and WEB-2 folders exist; the new note is saved under obsolete WEB-1. The helper has this bug, but the current built-in doctor collection order generally records renumbers before plugin fixes run. `recordStory` is not exposed through the plugin facade. Do not count this as a reproduced ordinary built-in workflow.

**Recommended change:** Choose the narrow supported identity policy first. Story keys/Board ownership should not be changed casually through ordinary plugin `updateStory`; renumbering belongs to core doctor. For supported renumber plans, retain scope identity and filename in queued file changes and resolve their final physical destination at plan preparation, or explicitly reject an owner rename after its files have been queued. Either policy must be enforced and documented. A generic cross-Board move abstraction is unnecessary: the domain says a Story never moves to another Board.

**Acceptance/tests:** `test/plugins/fileScopeChanges.test.ts`: the reproduction either saves the file under WEB-2 without orphan folders or rejects before touching disk according to the accepted policy. Existing successful renumbering preserves preexisting plugin files. File deletion/read semantics follow the same identity policy.

**Dependencies/ownership:** Change Set/storage owner with RES-06/08/24. Avoid an independently invented stable-identity framework conflicting with the doctor fix.

### <a id="res-11"></a>RES-11 — Invalid bags are overwritten as if they were empty

**Severity:** critical. **Status:** CONFIRMED. **Disposition:** release blocker.

**Source:** `src/services/plugins/runtime.ts:189` maps invalid bag parse to `undefined`. `src/plugins/epics/tui.ts:13`, `:22`, and `:26` map that to “No Epic” then a clearing input; `src/plugins/specs/tui.ts:22` and `:26` map it to an empty replacement. `src/tui/screens/stories/form.tsx:48` submits every plugin's input. Comments: `src/plugins/comments/comments.ts:31` treats invalid as an empty Thread; `:89` replaces the whole bag on write.

**Trigger/reproductions:** `r13-invalid-bag-dropped.ts` seeds invalid object-valued Epic/Specs bags with extra fields, calls the real form field/input functions, then updates only the name using the produced input. `crosscheck.ts` seeds a Comments bag containing an old Comment with invalid timestamps and a future field, then calls `addComment`.

**Observed:** Epic and Specs bags disappear entirely after the name edit; doctor then has nothing to report. Adding a Comment replaces the invalid Thread with only the new Comment and drops the original Comment and future field. Another plugin's raw bag remains unchanged.

**Recommended change:** Keep `readBag`'s documented tolerant read contract, but distinguish raw bag presence from a successfully parsed empty value before writes. Existing-data mutations such as adding a Comment or adding/removing Spec links must reject invalid existing data with a plugin/path-attributed diagnostic instead of resetting it. For unrelated core form edits, submit a plugin's replacement input only if its fields actually changed; invalid plugin data should be visibly unavailable with explicit reset/repair behavior. Compare initial versus submitted values if that suffices; a global dirty-tracking framework is not necessary. Do not require universal bag versions or a migration engine to preserve the raw object.

**Acceptance/tests:** `test/plugins/invalidBagPreservation.test.tsx` checks a name-only form edit leaves invalid raw values untouched and keeps doctor warnings. `test/plugins/comments.test.ts` checks adding to invalid Story/Task Threads rejects without save. `test/plugins/specs.test.ts` checks incremental links do not discard invalid raw data. Explicit user reset is allowed and tested separately. Omitted/failed plugin fields must not generate clearing inputs.

**Dependencies/ownership:** Built-in data/API owner plus TUI forms owner; overlaps RES-12. Coordinate one form-input contract with the API reviewer. Unknown fields stripped by valid same-plugin schemas are a compatibility policy to document; this finding specifically proves invalid existing content loss.

### <a id="res-12"></a>RES-12 — A corrupt Epic blocks core form/filter loading and is invisible to doctor

**Severity:** major. **Status:** CONFIRMED for callbacks/services; full UI consequence follows from source. **Disposition:** release blocker for ordinary file corruption recovery.

**Source:** `src/plugins/epics/service.ts:17` parses JSON; `:28` loads all files using a rejecting `Promise.all`. `src/plugins/epics/index.ts:63`–`:66` checks only filename existence. `src/tui/screens/stories/pluginFields.ts:33` allows one plugin's field rejection to reject all field loading. `src/tui/screens/stories/form.tsx:36` then cannot show the form.

**Trigger/reproduction:** `r07-corrupt-epic-file.ts` seeds valid `good.json` and conflict-marked `bad.json`, then invokes Epic listing, Epic Story form/filter field functions, and doctor.

**Observed:** Listing and both field callbacks throw `ValidationError: Epic "bad" has invalid JSON`; doctor returns `[]`. Supported future Epic versions would likewise fail `EpicSchema` (`src/plugins/epics/model.ts:4` requires version 1), but the future-version variant was not separately run.

**Recommended change:** Epic doctor should validate every owned Epic JSON file independently and report its actual path, JSON/conflict/schema/version/name mismatch, keeping the raw file untouched. A corrupt file must not make the checker abandon all remaining files. At the host UI level, isolate field loading per plugin and keep core/healthy-plugin fields usable. Carry the set of successfully loaded fields/plugins to submission so failed fields do not emit replacement inputs. Input conversion failures should block that submission with attribution, rather than silently ignore an explicitly chosen mutation.

**Acceptance/tests:** `test/plugins/epicsCorruption.test.ts`: bad JSON, conflict markers, unsupported version, ID/path mismatch; valid files remain diagnosable and no file is rewritten by check. `test/plugins/tuiFailureIsolation.test.tsx`: Story creation/editing and Board/Story filtering remain usable with an unavailable plugin field, warning includes plugin ID, and saved bags are preserved. Do not silently unlink references to a corrupt-but-present Epic.

**Dependencies/ownership:** Built-in Epic/doctor owner and UI field owner, with RES-11/13/16. Reporting invalid plugin files need not force their CLI read failures into core `DATA_INTEGRITY`; choose/document the error contract consistently.

### <a id="res-13"></a>RES-13 — Screen error handling intentionally rethrows ordinary plugin errors

**Severity:** critical if it terminates the TUI; major loss of UI availability otherwise. **Status:** CONFIRMED boundary behavior; end-to-end fatal Ink outcome INFERRED. **Disposition:** release blocker for plugin UI failure isolation.

**Source:** `src/tui/components/PluginSlot.tsx:16` invokes plugin rendering without a local boundary; `src/tui/screens/plugins/PluginScreen.tsx:22` directly mounts a plugin screen. `src/tui/shell/ScreenBoundary.tsx:25` rethrows everything except `RowblyError`.

**Trigger/reproduction:** `extra.ts` constructs the actual `ScreenBoundary`, puts a `TypeError('plugin render bug')` in its error state, and invokes render.

**Observed:** The ordinary error is rethrown. This confirms the boundary policy, not a complete Ink exit sequence. React synchronous render/commit-effect failures can reach a boundary; detached promises/timers cannot.

**Recommended change:** Add a plugin-local boundary that catches ordinary plugin render and synchronous commit errors, names the plugin, and renders a small unavailable-section fallback. Wrap both plugin screens and all slot content. The wrapper must enclose a child component that performs the `render(context, ui)` callback; invoking that callback while rendering the boundary's parent would still bypass the boundary. Do not globally swallow all core programming errors. Reset/retry only on explicit retry or meaningful plugin/route changes, not every rerender.

**Acceptance/tests:** `test/plugins/tuiFailureIsolation.test.tsx`: real mounted screens, Story/Task tabs, Board/settings sections throw during render and synchronous effect; core content, escape/navigation, and healthy plugin content remain usable. Expected Rowbly errors retain hints; ordinary errors include plugin identity. Repeat render does not create a warning loop. Input/filter summary callbacks executed outside slots need their own attribution wrapper, including `pluginFields.ts:80`.

**Dependencies/ownership:** TUI/API owner with RES-12/18. New components follow AGENTS.md: one component per PascalCase file, exported through the area barrel; shared helpers in separate camelCase files.

### <a id="res-14"></a>RES-14 — Duplicate option declarations pass loading and abort program construction

**Severity:** major. **Status:** CONFIRMED. **Disposition:** release blocker for the promised skip-failed-plugin behavior.

**Source:** `src/services/plugins/host.ts:194` compares only previously claimed names, not duplicate names inside the current declaration. `src/commands/plugins.ts:99` attaches the plugin command group before `:107` adds options outside the commands callback's catch.

**Trigger/reproduction:** `extra.ts` declares `--foo <x>` and `--foo <y>` on `stories create` in one enabled plugin, then calls `createProgram(host)`.

**Observed:** Host reports the plugin loaded; Commander throws “Cannot add option '--foo <y>' … conflicting flag '--foo'”. Construction aborts. Before the exception, an earlier option may already have been added, and a command group would already be attached if the plugin declared one. No successful main parse with these partial registrations was claimed.

**Recommended change:** Validate current-plugin literal flags/Commander attribute identities before applying registrations. Allow the intentionally supported positive/negative pair such as `--epic` and `--no-epic`. Prepare command groups/options on detached structures, then publish only a fully valid plugin registration. Catch preparation/attachment errors per plugin and mark it failed without leaving names/options/input adapters behind. Keep the catch narrow enough to identify the responsible plugin.

**Acceptance/tests:** `test/plugins/registrationFailure.test.ts`: duplicate flags skip the plugin; core commands still parse; no command, option, or input adapter from the failed plugin remains. Assert valid negation pairs and cross-plugin clashes retain current behavior. Include a successful command callback followed by failing option preparation.

**Dependencies/ownership:** Host/CLI owner; shared registration lifecycle with RES-22/25 and other reviewers' clash findings. Do not independently change Commander parsing and claims semantics in separate patches.

### <a id="res-15"></a>RES-15 — An unresolved reaction prevents completion and blocks later reactions

**Severity:** major. **Status:** CONFIRMED. **Disposition:** useful improvement; required before adding a reaction plugin that must meet the “failure only warns, exit stays 0” guarantee.

**Source:** `src/services/plugins/runtime.ts:116` runs reactions sequentially; `:121` awaits each without a deadline; `:128` waits in command mode. Current built-in Epics/Specs/Comments do not declare reactions.

**Trigger/reproductions:** `r18-hang-and-fix-isolation.ts` races an operation with a 1.5-second timer while the reaction never resolves. `more.ts --hang` directly awaits the operation at top level without a persistent handle.

**Observed:** Board name is saved as “X” while the operation promise remains pending. In the top-level-await case Node 24 exits 13 with an unsettled-await warning. Later reactions cannot run past the unresolved first one. This is not an unconditional forever-running process.

**Recommended change:** Give post-save reactions a bounded documented deadline, warn on timeout with plugin/operation identity, and continue later reactions. Ensure the deadline's timer keeps the command alive long enough to produce its normal result. Clear timers on settlement and account for late rejection. Add cooperative cancellation only where a real capability can use it. Do not prescribe timeouts around every plugin API endpoint merely by analogy.

If pre-save deadlines are separately introduced, seal/revoke the Change Set on timeout and prevent late service writes through RES-05. `Promise.race` does not cancel arbitrary JavaScript, and timers do not interrupt a synchronous infinite loop. A worker framework is not required for this reaction timeout fix.

**Acceptance/tests:** `test/plugins/reactionTimeout.test.ts`: unresolved reaction times out, operation returns the saved result, CLI exits 0, warning includes plugin ID, later reaction runs, and no timer leaks after successful reactions. Preserve TUI nonblocking behavior. A timeout never undoes committed data or suggests retrying a mutation already saved.

**Dependencies/ownership:** Runtime owner with RES-05/06. Coordinate timing semantics with a future Git capability; no current external process capability was assumed.

### <a id="res-16"></a>RES-16 — Command, filter, and option conversion errors omit plugin identity

**Severity:** minor. **Status:** CONFIRMED for command/filter; option conversion exposure INFERRED. **Disposition:** useful improvement and small documented-contract fix.

**Source:** `src/commands/plugins.ts:124` delegates to the action without wrapping; `src/services/stories.ts:271` invokes filters without wrapping; `src/commands/_shared.ts:74` invokes option input conversion directly. `docs/PLUGINS.md:76` promises `details.plugin` for plugin errors.

**Trigger/reproduction:** `extra.ts` invokes `main` with a throwing `filterStories` and a throwing action run through `cli.run`, each in JSON mode.

**Observed:** Both return exit 1. Stderr is respectively `{"error":{"code":"INTERNAL","message":"filter bug","details":{}}}` and the same shape with “command bug”. The generic error mapper works; attribution is missing.

**Recommended change:** Add a shared plugin invocation helper for these entry points and TUI field conversions/summary callbacks. Unexpected errors become plugin-attributed INTERNAL errors with stage information and disable hint. Expected Rowbly errors from plugin commands should retain validation/not-found/conflict codes and gain plugin attribution rather than all becoming INTERNAL. Preserve core error pass-through in replacements. Avoid double wrapping an already attributed `PluginError`.

**Acceptance/tests:** `test/plugins/cliFailureAttribution.test.ts`: throws from command, filter, and option input produce plugin details; expected errors retain exits 2/3/4; core replacement errors keep current codes. CLI JSON retains the current top-level error schema. Test a non-Error thrown value too.

**Dependencies/ownership:** CLI/error API owner; runtime helper extraction overlaps RES-05/15 and other reviewers' error-contract work.

### <a id="res-17"></a>RES-17 — Doctor reconstructs the wrong ID for multiword plugins

**Severity:** minor. **Status:** CONFIRMED. **Disposition:** useful improvement.

**Source:** `src/services/doctor.ts:534` converts hyphens into underscores for codes; `:632` takes only the first underscore-separated segment when wrapping a failed fix.

**Trigger/reproduction:** `more.ts` defines `two-words`, whose `BROKEN` doctor fix throws.

**Observed:** Details are `{"plugin":"two","code":"TWO_WORDS_BROKEN"}`; the disable hint also points at `two` instead of `two-words`.

**Recommended change:** Store plugin ID as explicit internal finding metadata when registering findings. Use that exact ID for fix attribution and hints; never infer identity from presentation codes. Keep the existing uppercase code format.

**Acceptance/tests:** Extend `test/plugins/doctor.test.ts`: failed fix from `two-words` and an ID with multiple hyphens preserves the complete ID in details/hint, and core finding errors are unaffected.

**Dependencies/ownership:** Doctor owner; combine with RES-09 to avoid edits to the same findings/pass machinery.

### <a id="res-18"></a>RES-18 — Three execution boundaries are broader than their catches

**Status:** INFERRED. This ID remains stable, but its subcases have separate severity and disposition. None was reproduced as a full app crash in this follow-up.

**RES-18A — Static plugin module evaluation.** Potential **critical** startup failure; **optional containment improvement** for trusted built-ins. `src/cli.ts:3` statically imports the registry, whose `src/plugins/index.ts:4`–`:6` eagerly import definitions. A top-level throw occurs before `main`/`loadPlugins` can catch it and regardless of enabled state. `definePlugin` at `src/plugin-api/index.ts:98` simply returns its argument; it does not itself perform risky loading/validation. Therefore “definePlugin throws” is not a current independent failure path.

If per-plugin module-import containment becomes a requirement, use lightweight descriptors with lazy loaders and catch each load. Otherwise keep the static registry and add startup/build coverage for the actual built-ins. Do not prescribe a registry overhaul just to treat a shipped source bug as a recoverable user-config error. Acceptance: a synthetic throwing import is skipped only if lazy containment is adopted; actual CLI build/startup smoke tests cover all built-ins either way. Proposed file: `test/plugins/moduleFailure.test.ts`. Owner: entry point/host; coordinate with API architecture work.

**RES-18B — Detached promises/timers.** Potential **critical** uncaught rejection/exception; **documented limit and useful contract enforcement**, with worker/process isolation an **optional abstraction**. `src/services/plugins/runtime.ts:144` catches the returned promise, not a timer or unreturned promise created by the handler. The Action wrapper at `src/tui/shell/Shell.tsx:67` has the same ordinary JavaScript limitation. Require plugin-owned work to be returned/awaited, and add subprocess fixtures showing supported versus unsupported behavior. If a concrete asynchronous capability needs lifecycle tracking, provide it there; do not add an unused global task registry. Do not use a global uncaught-exception handler to claim the application can safely continue. Acceptance: `test/plugins/asyncFailure.test.ts` documents awaited rejection handling and detects unsafe detached work in fixture subprocesses. Owner: runtime/capabilities; dependencies RES-05/15. Hard termination of synchronous loops or arbitrary JavaScript requires an isolation boundary and is outside the current built-in API's guarantee.

**RES-18C — Synchronous `useAsync` callbacks.** **Minor** helper robustness issue; **useful small fix**. `src/tui/hooks/useAsync.ts:29` calls `fn()` before the rejection handler exists. A function typed to return a promise can still throw synchronously. Most current callers use `async`, which turns their throws into rejections; no current built-in service failure was shown to crash through this path. Invoke through `Promise.resolve().then(fn)` and retain the current cancellation flag. Acceptance: `test/tui/useAsync.test.tsx` covers a synchronous throw, rejected promise, and stale completion after unmount/dependency change. Owner: TUI hooks; overlaps RES-13 but does not require a new error-boundary architecture.

### <a id="res-19"></a>RES-19 — The prefix cache disagrees with externally changed Boards

**Severity:** major. **Status:** CONFIRMED with two service instances. **Disposition:** useful improvement for long-lived TUI + CLI coexistence; required if that workflow is advertised.

**Source:** `src/storage/repositories.ts:60` keeps the prefix index for the repository lifetime; `:90` rebuilds only when locally invalidated; `:128` consults it for Story lookup. Board listing reads current files independently.

**Trigger/reproduction:** `r10-prefix-cache.ts` warms one service's index, creates Board `api` and API-1 through another service, then queries the original one.

**Observed:** Original services list the new Board and Board-scoped Stories but `stories.get('API-1')` throws “no Board has key prefix API”. Creating API-2 through the original instance succeeds, so the API is internally inconsistent.

**Recommended change:** Prefer the simple bounded fix: rebuild the small Board prefix map for a lookup or validate cached Board configuration freshness. Rebuild-on-miss alone misses deletion/prefix reassignment cases. Adopt a root generation counter/watcher only if already justified by a measured broader cache need; handwritten file/Git edits must still be accounted for.

**Acceptance/tests:** `test/storage/repositoryFreshness.test.ts`: two instances create/delete/reassign Board prefixes and long-lived Story lookups agree with current Board lists; retry after a failed index build works. A former prefix cannot point to a changed Board incorrectly.

**Dependencies/ownership:** Repository owner; coordinate RES-02, but a cross-process lock alone does not invalidate this in-memory cache.

### <a id="res-20"></a>RES-20 — TUI reload repeats the promised once-per-run load warning

**Severity:** minor. **Status:** CONFIRMED. **Disposition:** useful improvement.

**Source:** `src/tui/loadPlugins.ts:37` emits every failure on every call; `src/tui/app.tsx:68` reloads through that function. The once-per-run promise is in `docs/PLUGINS.md:47`.

**Trigger/reproduction:** `crosscheck.ts` loads the same throwing-start plugin twice through `withPlugins` into one toast collector.

**Observed:** Two warnings are pushed. The test collector counts pushes rather than deduplicated visible toast text. The real store at `src/tui/hooks/toasts.ts:35` also appends rather than deduplicating, though it limits displayed toasts to three.

**Recommended change:** Keep a small session-owned set keyed by Data Root and plugin ID (and, if desired, failure reason). Use it for failure notifications across reloads. Plugin status must still show failures every time. Decide explicitly whether a changed reason or recovery followed by a new failure warrants another toast. Do not globally suppress reaction/row warnings under a promise that concerns load failure only.

**Acceptance/tests:** `test/plugins/tui.test.tsx`: repeated reload of one failure pushes once; another root's failure can warn; status remains accurate; disable/enable transitions follow the chosen policy. Existing CLI once-per-process warning behavior remains unchanged.

**Dependencies/ownership:** TUI activation owner with RES-23. No need to change the general toast store.

### <a id="res-21"></a>RES-21 — Valid plugin paths follow symlinks outside their scope

**Severity:** major if file confinement is intended; otherwise a documented capability limitation. **Status:** CONFIRMED. **Disposition:** useful filesystem-policy improvement; adversarial sandboxing is optional/out of scope.

**Source:** `src/services/plugins/changeSet.ts:278` reads a joined path; `:198` writes a joined path; `src/storage/system.ts:34` follows normal filesystem symlinks. Name validation does not address real paths.

**Trigger/reproduction:** `more.ts` symlinks `<root>/plugins/paths` to a sibling `outside` directory, then reads/writes `secret.txt` using ordinary valid names.

**Observed:** `files.read` returns “secret” from outside the root; plugin operation overwrites the external file with “overwritten”. Traversal-free names do not provide symlink confinement.

**Recommended change:** Decide/document the symlink policy. If capability scopes must remain inside their owner, reject symlinked plugin directories/files and verify containment when resolving existing parents and staging destinations. A simple trusted-filesystem policy plus `lstat`/realpath checks can address accidental links. Do not claim a check-then-open sequence is race-proof against an adversary swapping symlinks, or extend the first-build scope into a full third-party sandbox.

**Acceptance/tests:** `test/plugins/filePaths.test.ts`: linked plugin root, nested parent, and linked target are rejected under a no-symlink policy; outside bytes stay unchanged. Normal nested names work; valid owner scopes still resolve. If symlinks are intentionally allowed, document external writes explicitly rather than silently claiming confinement.

**Dependencies/ownership:** Storage/security/API reviewers agree on policy before implementation; interacts with RES-01/03 staging paths.

### <a id="res-22"></a>RES-22 — A late load failure still blocks later plugins' name claims

**Severity:** minor (major availability impact for a colliding healthy plugin). **Status:** CONFIRMED for command load failure. **Disposition:** useful improvement to complete skip-failed-plugin semantics.

**Source:** `src/services/plugins/host.ts:89` commits name claims during start; `:116` only removes active status on later failure. `src/commands/plugins.ts:96` marks a throwing command callback failed after all registry claims were decided. TUI import failures at `src/tui/loadPlugins.ts:18` have the analogous ordering.

**Trigger/reproduction:** `crosscheck.ts`: first plugin `fails` claims `--shared` but throws from `commands`; later plugin `later` legitimately declares the same option.

**Observed:** `fails` is skipped for its commands failure, but `later` remains failed with “--shared is already an option”. No partial command group from the throwing callback is attached: the group was detached. The confirmed bug is retained claim/collateral failure, not leaked commands from that callback.

**Recommended change:** Make clash resolution and the fallible surface preparation part of one activation sequence for the surface in use, or release failed claims and reevaluate affected later candidates before publication. Do not merely delete a claim after later plugins have already been rejected. Keep deterministic registry order and successful-plugin ownership. No package dependency/resolver framework is needed.

**Acceptance/tests:** `test/plugins/registrationFailure.test.ts`: later plugin loads after earlier commands preparation fails; analogous TUI import failure does not unnecessarily reserve an Action key if the contract treats the earlier plugin as wholly skipped. Healthy earlier plugins still win. Warnings/status describe actual final activation results.

**Dependencies/ownership:** Host/CLI/TUI loading owner with RES-14/25. Decide whole-plugin versus surface-only failure semantics once with the architecture reviewer.

### <a id="res-23"></a>RES-23 — The no-loader TUI path skips reaction mode and load notifications

**Severity:** minor. **Status:** CONFIRMED for flag/notification control flow; unresolved-operation UI effect INFERRED. **Disposition:** useful improvement for the existing injected-host path.

**Source:** `src/tui/loadPlugins.ts:33` returns before `:35` sets `backgroundReactions` and before `:37` emits failures. `src/tui/index.ts:105` calls this helper with an optional loader.

**Trigger/reproduction:** `crosscheck.ts` passes an existing host and no loader to `withPlugins`. Existing TUI tests manually set `backgroundReactions: true`, masking the default difference.

**Observed:** `backgroundReactions` remains false/undefined. The helper does not notify existing host failures. A TUI import failure would be marked failed but likewise return without notifying through this helper. Standard CLI-launched TUI passes a loader and takes the good path.

**Recommended change:** Always set TUI reaction mode and perform failure notifications after loading the current host's TUI contributions. Only the host-replacement step should depend on the presence of a loader. Reuse RES-20's session warning policy.

**Acceptance/tests:** `test/plugins/tui.test.tsx`: injected-host/no-loader startup uses background reactions, reports import/settings failures, and keeps healthy plugin slots; standard loader path behaves identically. Add no-loader reaction service test without manually pre-setting the flag.

**Dependencies/ownership:** TUI activation owner with RES-15/20; a small branch restructuring, not a new provider abstraction.

### <a id="res-24"></a>RES-24 — A Board created in the pending Change Set cannot own a plugin file yet

**Severity:** minor API inconsistency (major if required by a plugin's Board-create transform). **Status:** CONFIRMED at helper level. **Disposition:** useful improvement.

**Source:** `src/services/plugins/changeSet.ts:242` consults pending Stories only; `:254` always reads a Board scope from disk.

**Trigger/reproduction:** `crosscheck.ts`: queue `putBoard({ ...existing, id: 'new', keyPrefix: 'NEW' })`, then `writeFile({ board: 'new' }, 'note.txt', 'x')` in the same Change Set.

**Observed:** `NotFoundError: Board "new" not found`, despite the pending Board. A `boards.create` transform requiring initial plugin files would fail before save. No current built-in was shown requiring this.

**Recommended change:** Resolve Board scopes against the pending Board state before disk, including the deleted-owner distinction from RES-08. Keep Story and Board scope semantics symmetric without introducing a separate graph/identity subsystem.

**Acceptance/tests:** `test/plugins/fileScopeChanges.test.ts`: Board creation plus file write commits in one guarded operation; a guard rejection writes neither; deleted Board scopes cannot recreate folders; mixed-case Story keys still resolve correctly.

**Dependencies/ownership:** Change Set scope owner with RES-08/10; merge these edits together.

### <a id="res-25"></a>RES-25 — Global negated options are not normalized for clash detection

**Severity:** minor. **Status:** CONFIRMED that the declaration is accepted; downstream value override not reproduced. **Disposition:** useful small fix.

**Source:** `src/main.ts:40` collects global names without stripping `no-`; `:45` normalizes subcommand names only. `src/services/plugins/host.ts:197` normalizes plugin names, so a global `no-prompt` is compared with plugin `prompt` incorrectly.

**Trigger/reproduction:** `crosscheck.ts` defines `--prompt <x>` on `stories create`. The program already owns global `--no-prompt`.

**Observed:** Host reports the plugin loaded; constructed help lists its option. This violates the intended global-option reservation. The reproduction does not claim a specific prompt/confirmation bypass.

**Recommended change:** Normalize global option base names with the same `no-` rule used for core subcommands and plugin options. Apply the Commander attribute-name policy agreed under RES-14 consistently. Keep the existing accepted in-plugin positive/negative pairs.

**Acceptance/tests:** Extend `test/plugins/load.test.ts`: plugins declaring either polarity of a reserved global base name fail loading; `--prompt` cannot take the global `prompt` attribute; existing Epic negation flags still work. Actual parser test verifies globals remain authoritative.

**Dependencies/ownership:** CLI/host clash owner with RES-14/22; one shared naming rule rather than independent normalization helpers.

## Behaviors inspected that are not separate defects

### Bag shape, versions, and preservation

`src/schemas/primitives.ts:40` requires each bag to be an object. `r12-invalid-bag-shape.ts` confirms an array-valued `ghost` bag makes its Story fail core schema validation, blocks Board-wide listing/create, but does not block direct read of a healthy Story. Doctor reports `SCHEMA_INVALID` with `plugins.ghost`. This is strict enforcement of the documented bag shape, not silent plugin data deletion; loosening core schema shape is not prescribed.

`crosscheck.ts` confirms `writeBag` for one plugin preserves another plugin's arbitrary object-valued data. `test/plugins/bags.test.ts:51` and `:87` cover core preservation for off/unknown plugins. JSON serialization normalizes formatting, so “byte-for-byte” should mean unchanged plugin file bytes or semantic bag values as appropriate. No serialized JSON substring preservation requirement was found.

Core persisted roots and Epic files require `version: 1` (`src/schemas/primitives.ts:44`, `src/plugins/epics/model.ts:4`). Bags are opaque to core and not universally versioned; Comments and Specs bags have no required version. Unsupported core versions fail schema validation; unsupported Epic versions fail plugin parsing and need RES-12 diagnostics. Do not add universal migrations or version wrappers before a real format transition. Preserve unsupported data on ordinary edits under RES-11, document each plugin's compatibility expectations, and test the first actual migration when introduced.

### Paths and deletion

`crosscheck.ts` confirms `../x`, `/tmp/x`, `a/../x`, `./x`, and `a//x` all produce VALIDATION for file reads. `src/services/plugins/changeSet.ts:36` permits only safe relative segments; `:281` checks names. Board scope IDs are validated through `boards.get`, and Story scopes use `parseStoryKey`. Built-in Epic IDs and Spec slugs also validate before choosing filenames. No ordinary string traversal bug was reproduced; RES-06 bypasses the internal plan's validation and RES-21 concerns symlinks.

Normal Story/Board deletion removes whole folders and all plugins' descendant files. Renumbering normally moves the whole Story folder. Those guarantees are directly tested in `test/plugins/pipeline.test.ts:236` and `:263`. They should not be replaced by enumerating only active plugins' known files.

### Loading, enable/disable, and settings

Host settings validation, defaults, Board deep merges, unknown enabled IDs, and throwing `start` are isolated by `loadPlugins`' per-definition catch. Startup claims are committed only after a successful start. `commands()` receives a detached command group, so a throw there does not attach that partial group/options; failures later in option attachment are RES-14. `tui()` import errors are caught and remove the plugin from the active host. RES-22 concerns name reservations made earlier, not a demonstrated command callback leak.

Enable/disable edits only `enabled` and preserves settings/data. CLI changes take effect next process by design. The TUI settings screen awaits reload, creates fresh services/host/TUI contributions, and has an existing enable/disable integration test (`test/plugins/tui.test.tsx:126`). No current reproduced stale-registration issue survives that path. A hypothetical async activation race is not asserted as a finding without a repro.

Load failures warn once in the normal CLI startup; RES-20 covers TUI session reloads. Runtime row/reaction warnings are not subject to the load-warning promise.

### Error handling already correct

Ordinary `updateStory` calls read the pending `after` when present and disk only when absent (`src/services/plugins/changeSet.ts:73`–`:77`); updates compose in one Change Set. A pending deletion produces NotFound instead of resurrecting through that method. Its update lookup uses current keys while the public `story()` view matches before or after keys; that divergence after structural renumbering is relevant to RES-09 and identity policy in RES-10. An invalid value passed through `putStory`/`putBoard` is validated immediately; the bypass reproduced in RES-06 requires exposed mutable objects. Do not weaken those existing validations while replacing views.

Awaited/synchronous transform, guard, and replacement exceptions pass through `inPlugin` and identify plugin/operation/stage. Guard rejection is CONFLICT, exit 4, with plugin details. Replacement `core()` errors retain their core codes. A failed pre-save handler saves nothing provided it does not violate RES-05 by independently mutating data. Returned reaction rejection warns after saving and leaves success. No claim is made that this catches detached async code.

`src/services/plugins/service.ts:85` isolates row callbacks and continues other plugins. `src/tui/shell/Shell.tsx:65` wraps Action invocation in a promise chain and catches synchronous throws and returned rejection. `src/tui/components/Form.tsx:122` catches awaited submission failure and resets busy state; throwing plugin input inside the async submit is therefore a submission failure, not automatically an uncaught application crash. Render-time filter descriptions still need RES-13/16 handling.

`r18-hang-and-fix-isolation.ts` also proves a throwing plugin doctor fix aborts the current pass with a `PluginError` and leaves its pending core duplicate-key repair unsaved. This agrees with ADR-0012. A doctor check exception is caught as a PLUGIN_FAILED finding at `src/services/doctor.ts:549`; separate healthy checks still run. An unresolving checker has no deadline, but no real built-in checker hang was reproduced, so a blanket callback deadline framework is not required by this report.

CORE_KEYS rejects declared core/earlier Action key clashes, including duplicates within one plugin. No printable runtime key collision bypass was reproduced. Keep the reservations synchronized when adding new core shortcuts; do not invent a dynamic priority router based solely on this review.

## CLI failure contract cross-check

| Path | Current behavior / evidence | Required correction |
| --- | --- | --- |
| Bad settings / start / unknown enabled ID | Skipped; warning; core commands proceed; doctor PLUGIN_FAILED exits 6 (existing tests) | Preserve |
| Commands callback throws | Skipped before detached group attaches | RES-22: reevaluate later claims |
| Option attachment fails | Ordinary error reaches main; program construction aborts | RES-14 |
| TUI import throws | Marked failed, removed from active host | RES-20/23 notifications and RES-22 claims |
| Guard rejection | CONFLICT, exit 4, `details.plugin` | Preserve |
| Awaited transform/guard/replacement error | INTERNAL, exit 1, plugin details | Preserve; RES-05 nested saves |
| Core error from replacement `core()` | Original core code/exit | Preserve |
| Returned reaction failure | Warning after save, exit 0 | Preserve; RES-15 unresolved promise |
| Filter / raw command Error | INTERNAL, exit 1, empty details (reproduced) | RES-16 attribution |
| Expected plugin command RowblyError | Existing Rowbly exit mapping, e.g. validation 2 / not found 3 | Add attribution without flattening to INTERNAL |
| Plugin option input throw | Unwrapped through core command input conversion (source) | RES-16 |
| Save I/O failure | Usually INTERNAL, exit 1; partial state possible | RES-01/03/04; describe recovered/incomplete state accurately |
| Invalid object-valued bag | Tolerant reads; doctor warning; destructive writes possible | RES-11 |
| Invalid non-object bag / core future version | DATA_INTEGRITY on read, exit 6 | Preserve raw file and diagnostics |
| Doctor fix throws | INTERNAL, exit 1; current pass unsaved | Preserve, RES-17 exact identity |
| Static module / detached throw | Outside normal per-plugin catch | RES-18 explicitly bounded guarantee |

No `--json` shape redesign is requested. Keep `{"error":{"code":...,"message":...,"details":...,"hint":...}}` according to existing optional fields. Do not emit multiple “successful mutation” results for one operation merely to compensate for partial saves.

## Existing tests and gaps

The suite's strengths are normal behavior and pre-save rejection. Preserve these specific anchors. The consolidated error decision intentionally changes expected plugin-thrown domain errors to retain their meanings across host-controlled callbacks; update current ADR/text and tests that currently say every thrown hook error becomes INTERNAL. The generic TypeError/Error tests below should still expect INTERNAL.

| Property already covered | Existing test anchor |
| --- | --- |
| Registry enable/order; no root disables plugins | `test/plugins/load.test.ts:13`, `:25` |
| Start/settings/unknown failures skipped | `test/plugins/load.test.ts:31` |
| Schema defaults and Board cascades | `test/plugins/load.test.ts:60`, `:67` |
| Declared command/option/replacement/Action clashes | `test/plugins/load.test.ts:79`, `:85`, `:101`, `:109`, `:126` |
| markFailed removes active plugin; enable/disable preserves data | `test/plugins/load.test.ts:143`, `:154`, `:164` |
| Transform order and attribution; guard rejection/final views | `test/plugins/pipeline.test.ts:38`, `:47`, `:64`, `:88` |
| Replacement works and preserves core errors | `test/plugins/pipeline.test.ts:101`, `:110` |
| Post-save reaction warnings; TUI does not await | `test/plugins/pipeline.test.ts:119`, `:126`, `:134` |
| Plugin operations guarded; owner files delete/renumber | `test/plugins/pipeline.test.ts:221`, `:236`, `:263` |
| Filtering and row exception isolation | `test/plugins/pipeline.test.ts:290`, `:317` |
| Off/unknown bag values preserved across core operations | `test/plugins/bags.test.ts:51`, `:87` |
| Doctor failure/schema/unchecked data; guardable fixes | `test/plugins/doctor.test.ts:15`, `:31`, `:51`, `:64`, `:84` |
| CLI once-per-run warning, failure exits/JSON identity | `test/plugins/cli.test.ts:64`, `:84`, `:111`, `:123` |
| UI slot integration and settings reload; import throw | `test/plugins/tui.test.tsx:54`, `:98`, `:108`, `:119`, `:126`, `:144` |
| Epic/Spec guarded delete and missing-link fixes | `test/plugins/epics.test.ts:114`, `test/plugins/specs.test.ts:67`, `:80`, `:112` |

Missing resilience coverage includes failure during commit, actual process death/recovery, cross-process lost updates, mutable/deferred Change Set handles, deletion/file-write contradictions, orphan key adoption, duplicate identity plus plugin repair, invalid existing bags on writes, corrupt plugin files, component render/effect errors, synchronous `useAsync` callbacks, unresolved reactions, late-registration claim release, TUI repeated warnings/no-loader startup, pending Board files, symlinks, and normalized global negation clashes. The proposed tests above cover observable consequences; do not replace them with assertions that merely mirror helper internals.

## Parallel execution ownership and sequence

| Workstream | IDs | Shared files / conflicts | Execution guidance |
| --- | --- | --- | --- |
| Storage coordination and recoverable commits | 01, 02, 03, 04, 07 | `storage/files.ts`, `jsonStore.ts`, `repositories.ts`, `system.ts`, `plugins/changeSet.ts`, doctor layout | One owner designs the commit primitive; others consume it. Agree recovery and lock scope before implementation. |
| Change Set/API safety and scopes | 06, 08, 10, 24 | `plugins/changeSet.ts`, `plugins/types.ts` | One owner handles snapshots, sealing, scope tri-state, and identity restrictions. Coordinate final plan with storage. |
| Runtime operation rules and diagnostics | 05, 15, 16, 18B | `plugins/runtime.ts`, command wrappers, service filters | Reject nested writes before locking; keep core pass-through and reaction semantics. Shared attribution helper has one owner. |
| Doctor correctness | 09, 12 file checks, 17 | `services/doctor.ts`, built-in doctor callbacks | One owner changes fix pass ordering/metadata; uses storage recovery rather than inventing separate rollback. |
| Built-in existing-data preservation | 11, 12 Epic parsing | Epic/Specs/Comments data helpers and TUI contributions | Reject unsafe invalid-data mutations. Agree missing versus invalid form behavior with UI owner. |
| TUI isolation/activation | 12 field isolation, 13, 18C, 20, 23 | `PluginSlot`, plugin screens, field collector, `useAsync`, activation | Add local boundaries and omission tracking together; never synthesize clears for unavailable fields. |
| Host/CLI activation and naming | 14, 16 input attribution, 22, 25 | `host.ts`, `commands/plugins.ts`, `_shared.ts`, `main.ts` | One activation/claim policy; avoid duplicate flag normalizers or competing rollback of Commander registrations. |
| Repository freshness | 19 | `storage/repositories.ts` | Coordinate with storage owner; simplest correct cache policy first. |
| Filesystem capability policy | 21 | Plugin path resolution and staging | Agree trusted-filesystem/symlink policy with security reviewer before implementation. |

A practical dependency order is: agree source/identity and supported failure contracts; implement RES-05/06 and final-plan prevalidation; implement coordinated recoverable storage; fix doctor structural ordering; integrate scopes/orphans; land built-in preservation and UI isolation; finish small loading/diagnostic issues. Independent UI/naming work can proceed while storage is designed if file ownership is explicit. No source edit is part of this review.

## Optional abstractions that are not release tasks

- A database, general transaction DSL, distributed locking service, or per-plugin transaction manager: unnecessary for the existing local file primitives. A small journal and local process coordination are enough for the stated crash contract.
- Worker/process isolation for arbitrary JavaScript: only adopt if hard crash containment of third-party/detached/synchronous execution becomes an accepted requirement. It does not automatically isolate React rendering or make filesystem commits atomic.
- Persistent stable IDs on every Story/Board: not necessary to fix stale doctor closures; structural repairs followed by fresh analysis are a bounded alternative.
- Generic bag migration/version infrastructure: first preserve unsupported data and diagnose it; add migration for an actual version transition.
- A filesystem watcher/generation service: remove or correctly refresh the small prefix cache first. Manual file edits remain a supported source of freshness changes.
- General async task registries and deadlines around all hooks/UI APIs: implement a concrete reaction deadline where needed, and cancellation within real capabilities. Do not claim race-with-timeout cancels JavaScript.

## Reproducible evidence inventory

The supervisor's [durable reproduction archive](repros/README.md) is the preferred replay source. Run from `/home/sgolovine/Projects/rowbly`:

```sh
node_modules/.bin/tsx docs/reviews/plugin-architecture/repros/r03-partial-save.ts
```

Substitute any script name below. The scripts share the archived [lib.ts](repros/lib.ts), which creates schema-valid fixtures, uses fixed timestamps, and loads definitions with current `reservedNames()`. The original `/tmp/rowbly-review/node_modules` links to repository dependencies; its package/tsconfig select ESM and React JSX. Absolute imports target this checkout. If replaying in another checkout, copy/adapt paths in a temporary location rather than editing the evidence archive. Scripts are development reproductions, not production commands and not committed regression tests. Follow the archive README's permission and hang limitations.

Fresh logs are under `/tmp/rowbly-review/current-evidence/<script>.log`. The archived scripts survive `/tmp` cleanup; exact setup and observed results are recorded in each finding above. The supervisor independently reran concurrent create, stale-key doctor repair, and invalid-bag form input, with matching outcomes. Convert accepted cases into the named permanent regression files. This report links but does not modify the evidence archive.

| Script | Findings / evidence |
| --- | --- |
| [r01-concurrent-create.ts](repros/r01-concurrent-create.ts) | RES-02: two calls both return WEB-1, one record survives |
| [r02-reentrancy.ts](repros/r02-reentrancy.ts) | RES-05: nested description lost; fixture stops recursion at 51 |
| [r03-partial-save.ts](repros/r03-partial-save.ts) | RES-01/06: invalid second Story, EACCES, raw injected path |
| [r04-renumber-stray-folder.ts](repros/r04-renumber-stray-folder.ts) | RES-04: ENOTEMPTY leaves `.moving` folder |
| [r05-orphan-adoption.ts](repros/r05-orphan-adoption.ts) | RES-07: new Story reads old orphan Spec |
| [r06-doctor-stale-key.ts](repros/r06-doctor-stale-key.ts) | RES-09: keeper's valid Epic link removed |
| [r07-corrupt-epic-file.ts](repros/r07-corrupt-epic-file.ts) | RES-12: field callbacks fail while doctor has no findings |
| [r10-prefix-cache.ts](repros/r10-prefix-cache.ts) | RES-19: stale prefix lookup disagrees with lists |
| [r12-invalid-bag-shape.ts](repros/r12-invalid-bag-shape.ts) | Documented object-bag boundary, SCHEMA_INVALID |
| [r13-invalid-bag-dropped.ts](repros/r13-invalid-bag-dropped.ts) | RES-11: real field/input callbacks drop bags on name update |
| [r14-moving-folder.ts](repros/r14-moving-folder.ts) | RES-04: manually interrupted state, UNKNOWN_FILE, key reuse |
| [r18-hang-and-fix-isolation.ts](repros/r18-hang-and-fix-isolation.ts) | RES-15: 1.5-second pending operation; doctor fix throw safely aborts pass |
| [extra.ts](repros/extra.ts) | RES-06/08/13/14/16: deletion target mutation, resurrection, boundary policy, duplicate flags, missing JSON identity |
| [more.ts](repros/more.ts) | RES-17/21: wrong multiword ID, symlink read/write; `--hang` variant for unsettled await |
| [move-file.ts](repros/move-file.ts) | RES-10: direct Change Set path ordering |
| [text-failure.ts](repros/text-failure.ts) | RES-03: actual helper under file-size limit truncates old bytes |
| [crosscheck.ts](repros/crosscheck.ts) | RES-11 Comments, 20/22/23/24/25; ordinary traversal rejection and other-bag preservation |

The explicit unsettled-await variant is:

```sh
node_modules/.bin/tsx docs/reviews/plugin-architecture/repros/more.ts --hang
```

Its expected current exit is 13 on Node 24 with an unsettled top-level-await warning. It was executed in the original review; the regular `more.ts` cases were rerun in this follow-up. The text-size reproduction expects Bash/Unix resource limits and produced EFBIG/status 1 with 2,048 destination bytes in both reviews. Concurrency scheduling can vary; permanent tests should use barriers to make the overlap deterministic rather than relying solely on timing.
