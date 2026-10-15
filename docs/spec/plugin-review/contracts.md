# Contracts

These are the binding decisions for every package. They come from the review's [decisions](../../reviews/plugin-architecture/README.md#decisions-to-settle-before-parallel-implementation), [recommendations not adopted](../../reviews/plugin-architecture/README.md#recommendations-not-adopted-wholesale), and the "keep as-is" / "not a defect" sections of the detailed reports. WP00 turns §3–§7 into ADRs and published type signatures. Until WP00 merges, this file is the reference. After WP00 merges, the ADRs win wherever they are more specific.

**Order of precedence:**

1. The user.
2. This file, plus the ADRs that WP00 writes.
3. The package files.
4. The review's consolidated README.
5. The detailed review reports.

A detailed report sometimes offers alternative designs. The alternative chosen here is the one to build.

## 1. Vocabulary

| Term | Meaning in this spec |
| --- | --- |
| Operation | One `ops.run` invocation: one user action, one Change Set, one commit. |
| Stage | One of: `body`, `replacement`, `transform`, `guard`, `commit`, `reaction`, `doctor-check`, `doctor-fix`, `command`, `screen`, `field`, `filter`, `row`, `option-input`. |
| Plan | The Change Set's private collection of pending record and file changes. |
| Snapshot | A detached, deeply immutable view of the plan, or of a saved result. |
| Commit | Turning a validated, sealed plan into durable files through the transaction engine. |
| Participating reader | Any Rowbly code path that reads the Data Root through repositories after recovery has run. |
| Bag | `plugins.<id>` on a record. Its state is one of: **absent**, **valid**, **invalid**, or **unsupported** (a newer, unknown version). |

## 2. Priority and disposition handling

| Disposition in [findings.md](findings.md) | What the worker does |
| --- | --- |
| Recommended / Useful / Selected / Recommended-see-scope | Implement it. Read "see scope" in the detailed entry: the review often narrows the original recommendation. |
| Optional, Optional / bounded | Evaluate it. Implement only when the detailed entry's stated condition holds, for example "only if another consumer needs it" or "if touching this file". Otherwise set the status to `deferred: <one-line reason>`. Never build the larger abstraction the entry rejects. |
| External milestone, Conditional / decision | Follow the decision recorded in §9, or the package's instructions. If the condition is unmet, mark it `deferred: <reason>`. |
| Withdrawn | No code. The status is already `withdrawn`. Do **not** implement the original prescription. |
| Merged, Superseded | No separate task. The status is already `merged → <ID>`. Make sure the target finding covers it. |

When an optional item touches a file the package already edits, do the small version: a comment, a rename, a local helper. A separate package is never warranted for a nit.

## 3. Binding decisions

### D1 — One mutation coordinator per Data Root (WP02B primitive, WP02C integration)

- Coordination is cross-process and keyed by the **canonical** Data Root, meaning its realpath, so that aliases share a lock.
- An operation acquires coordination **before** it reads any state it uses to plan, and holds it through final validation, commit, and recovery. Coordination covers core mutations, plugin operations, doctor (analysis and fix), configuration changes, and Local State changes.
- A save-only mutex is not sufficient, and neither is a lock taken after a stale plan has been computed. A regression test must fail either of those designs.
- The ADR must specify:
  - how long acquisition waits before timing out;
  - how a stale lock left by a dead owner is recovered;
  - that the lock is released on every failure path;
  - that nested acquisition within the same operation reuses the held context for reads;
  - that nested *mutations* are rejected (D4) rather than deadlocking.
- The lock is released **before** reactions run, because reactions act outside Rowbly data.
- External editors and Git are outside the lock protocol. Rowbly documents this and detects conflicts where it can. It does not claim to protect against them.

### D2 — Recoverable filesystem transactions (WP02B engine, WP02A integration, WP02C recovery)

- Storage stays as JSON and Markdown files.
- The commit sequence is:
  1. Validate the **entire** final plan before touching live data. That means every record schema, parent lifecycle, source and destination identities, path containment, duplicate target moves, and occupied destinations.
  2. Stage the content.
  3. Write a durable manifest (journal) of the writes, deletions, and moves, with the original state.
  4. Apply the changes.
  5. Mark the transaction complete.
- Recovery is idempotent and runs before normal repository access. The ADR chooses one policy and states it: roll forward a prepared transaction, or restore the originals for an unprepared one.
- Text and JSON writes go to a unique temporary file in the same directory and are then renamed over the destination. A failed write never truncates the original (RES-03).
- The ADR states the durability guarantee in exact terms. It says whether the guarantee covers process death only or also power loss, and therefore whether fsync is used on files and directories.
- Participating readers never observe a half-committed operation. External readers may, and the documentation says so. Never describe this as instantaneous multi-file atomicity.
- In-memory rollback alone is not sufficient. Do not report "nothing saved" when recovery itself failed. Report save-stage errors with the affected paths and recovery guidance.
- Journal artifacts are recognized by doctor (WP03) and are excluded from Git data where appropriate.

### D3 — Private immutable identity, controlled mutation (WP01A views, WP02A identities)

- Plugins see only detached, deeply immutable snapshots.
- Transform code changes data **only** through the validated Change Set writer methods.
- Guards and reactions get read-only views.
- A writer handle lives only as long as its stage. A retained handle used later, from a guard, a reaction, a late continuation, or after sealing, throws without changing the plan.
- The plan keeps original storage identities (source paths) private. Changing a snapshot's `before.key` cannot redirect a deletion.
- Update callbacks receive copies. A callback that mutates its copy and then throws leaves the pending record intact.
- The plan is sealed before guards run, and again before commit.
- This is protection against accidental mutation. It is not a security sandbox.

### D4 — No nested data mutation from hooks (WP01A)

- An async execution context (`AsyncLocalStorage`) tracks the active operation, the plugin ID, and the stage.
- Starting a mutating operation (a core service mutation or `plugin.operation`) from inside a `replacement`, `transform`, `guard`, `reaction`, `doctor-fix`, or an already-running plugin operation `body` is rejected **before any save**. The error is an attributed error that tells the author to use the current Change Set.
- Reads stay allowed.
- A replacement's provided `core()` stays allowed and runs against the same Change Set.
- Commands and screens start operations normally.
- Unrelated concurrent operations, such as a TUI action running while a background reaction is pending, are not rejected. Never use a process-global boolean for this.
- Enforcement is at runtime, both at operation entry and at the writer methods. Narrow types help, but they are not enough on their own, because callers can capture contexts.
- This rule is implemented **before** WP02C enables the non-reentrant lock.

### D5 — Logical file scopes (WP02A)

- A pending file change stores the plugin ID, the relative filename, and the private owner identity. The final physical path is resolved at commit preparation, from the final owner state.
- Scope lookup has three states for Boards and Stories: **absent from the plan**, **present**, or **deleted**.
  - Writes to a deleted scope are rejected before save.
  - Reads of a deleted scope return absent.
  - A Board or Story created in the same plan can own files.
  - A Story renumbered after its file was queued takes that file with it.
- A parent deletion is never followed by recreating a child. No mkdir may revive a deleted owner.
- Cascaded deletion of a whole folder still removes the files of every plugin, including disabled ones. The plan does not enumerate them as separate FileChanges.
- Story keys and Board ownership are not changed through ordinary plugin `updateStory`. Renumbering belongs to core doctor. A Story never moves between Boards.

### D6 — Preserve opaque data (WP04A API, WP05A forms, WP08B/WP08C consumers)

- **Absent, valid, invalid, and unsupported bags are distinct states.** Never use a schema parse failure to mean "empty".
- `readBag` keeps its tolerant contract for display: it returns `undefined` when the bag is absent **or** invalid. Mutations of existing data use a strict read (working name `requireBag`). That read returns `undefined` only when the bag is absent. When the bag is present but invalid, it throws `DATA_INTEGRITY` with the plugin, path, and issues.
- An unrelated edit preserves invalid and unknown raw bag values semantically, including unknown keys. JSON whitespace and key order are **not** guaranteed. Current serialization normalizes them.
- Clearing a value is an explicit, dirty action. An unchanged or failed field provider never produces clearing input.
- Existing-data mutations reject invalid existing data until the user chooses an explicit repair or reset. Those mutations include adding a Comment and adding or removing Spec links.
- Data from unknown and disabled plugins survives every core operation (this is tested today in `test/plugins/bags.test.ts`).
- Do not add universal bag versions or a migration engine. Existing unversioned built-in bags are interpreted as legacy v1 (WP10A writes the policy).

### D7 — Expected errors keep their meaning (WP01B; amends ADR-0012)

| Thrown inside a host-controlled plugin callback | Result |
| --- | --- |
| `UsageError`, `ValidationError`, `NotFoundError`, `ConflictError`, `DataIntegrityError` | The same code and exit code, with its hint and issues kept. The framework adds `details.plugin`, `details.operation`, and `details.stage`. Framework attribution wins over details the plugin supplied. |
| A guard returning `{ reject, hint }` | `CONFLICT`, exit 4, attributed (unchanged). |
| A guard throwing an expected error | That error's code, attributed. |
| An unexpected throw (`TypeError`, a thrown string, etc.) | `PluginError` / `INTERNAL`, exit 1, attributed, with a hint to disable the plugin. |
| A core error from a replacement's `core()` | Passes through unchanged (current behavior). |
| An already-attributed `PluginError` | Not wrapped again. |

The same adapter wraps every host-controlled callback:

- hooks;
- plugin operation bodies;
- CLI command actions;
- option-input conversion;
- `filterStories`;
- rows;
- doctor checks and fixes;
- TUI field providers, input conversion, filter conversion, and filter summaries;
- Actions;
- reactions.

React render errors are handled by WP05B's boundaries instead. Doctor finding JSON includes `details.plugin` explicitly.

### D8 — Trust model (WP10A documents; nothing implements a sandbox)

- Built-in plugins are trusted code.
- Architectural import tests enforce conventions. They do not confine anything.
- Capabilities, frozen snapshots, and cooperative timeouts are guards against accidental misuse. They do not contain malicious code. A trusted in-process loader for third parties can be a deliberate future policy (WP10B). Running untrusted code safely would be a separate design, with a process boundary and a permission UI. That design is out of scope.
- Promise timeouts cannot interrupt synchronous loops or detached work. Say so wherever timeouts are documented.

### D9 — Do not expand the API while fixing integrity

- Order of work:
  1. Typed input validation.
  2. Operation results.
  3. Dirty forms.
  4. Shared CLI parsing.
- The declarative Story-field helper (DX-01) is optional. Consider it only after those primitives are stable, and only if a re-measured example shows a meaningful reduction.
- Do not build a second workflow engine, an operation-schema registry, a typed route DSL, or a family of generalized UI helpers for its own sake.
- Keep the current published operation verbs, including the Comments verbs `add/update/remove` that ADR-0018 approved, unless WP00 deliberately chooses otherwise (§9, W1).

## 4. Phase and capability table (WP04A types, WP01A enforcement)

| Stage | Change Set access | Services | Notes |
| --- | --- | --- | --- |
| `body` (core or plugin operation) | Writer | Read facade | Cannot start another operation. |
| `replacement` | Writer, plus `core()` | Read facade | No `result` before `core()` returns. Repeated `core()`: WP01B defines the rule (call-once with a diagnostic, or documented re-entry), and a test pins it. |
| `transform` | Writer with a stage lifetime. Records are deeply readonly, so changes go through writer methods only | Read facade | Receives `result`: the body or replacement result, before transforms (ARCH-03). |
| `guard` | Deeply readonly snapshot, plus pending `readFile` | Read facade | No writers at all, at compile time or at runtime. |
| commit | — | — | Internal. Holds the lock (D1). |
| `reaction` | Snapshot of the saved state, frozen once and shared by all reactions | Read facade, `warn` | Cannot write Rowbly data. Runs after the lock is released. Has a bounded deadline (WP01B). |
| `doctor-check` | — | Read facade, `DoctorData` (including `local`) | |
| `doctor-fix` | Writer (pending Change Set) | Read facade | Runs inside the doctor operation's phase scope. |
| `command` (CLI) | — | `PluginServices` (ordinary core domain services) | `PluginCommandEnv` owns `readText` and `editText` (the editor is CLI-only). |
| `screen`, `field`, `filter`, `row` | — | `PluginServices` | No `editText`. |

`PluginServices` excludes `plugins` (no `context(id)` for other plugins, and no enable/disable), `setup`, and doctor mutations (ARCH-05). Build it at runtime. Changing only the TypeScript type is not enough.

## 5. Bag and settings write contract (WP04A)

- `writeBag(record, bag)` returns `Omit<R, 'plugins'> & Bagged` (CQ-165). It never promises a narrowed `plugins` subtype after it clears or replaces the bag. Its `bag` parameter is `Record<string, unknown> | undefined` (CQ-25).
- `writeBag` on the root config is rejected at runtime before save (ARCH-08). The check is shape-based: `version` together with `assignees`. Root settings change only through an explicit merge that preserves `enabled` and the entries of other plugins. Enablement changes only through the plugins service.
- Board-settings writes are allowed only as documented settings. Settings stay separate from general data bags.

## 6. Result contract (WP04A types, WP01B finalization)

- Hook `result` types match the **public** operation results. Some examples:
  - `fields.update` reactions receive the array, not `{ next, stripped }`.
  - `boards.remove` and `context.clearUse` reactions receive `undefined`.
  - Plugin enable/disable reactions receive `{ id: string; enabled: boolean }`.
- An overload on core `OperationRunner.run` checks that core inputs and results match at compile time.
- Results returned to callers and to reactions are the final, post-transform values, read from pending data. That includes core records, arrays, LocalState, and plugin-owned records through an optional own-operation `result(changes, bodyResult)` finalizer.
- If a transform removes the entity the operation returns, the operation either fails before save or returns a documented nullable result. WP01B picks one rule and pins it with a test.

## 7. Transaction and visibility guarantee (WP02 ADR, documented by WP09B)

| Phase | Guarantee |
| --- | --- |
| Pre-commit: a body, hook, or validation rejects | Nothing is written, and no reaction runs. |
| Commit, then an I/O failure or process death | After recovery, the complete old state or the complete new state. Recovery is idempotent and runs again safely if interrupted. |
| Concurrent cooperating operations (other processes or service instances) | Serialized. No accepted change is silently lost. Story keys are distinct. |
| Participating readers | Never see a half-applied commit. |
| External tools: editors, Git, `cat` | May see intermediate files. Outside the lock protocol. Documented. |

## 8. Shared-file ownership and sequencing

1. **One editor at a time per file.** The supervisor never runs two packages that list the same file under **Owns**. Package dependencies are designed so that sequential owners of a shared framework file never overlap. The sequences are:
   - `types.ts`: WP04A → WP01A → … → WP04B
   - `runtime.ts`: WP04A → WP01A → WP01B → WP02C
   - `changeSet.ts`: WP01A → WP02A
   - `commands/**`: WP06 → WP01B → WP04B
   - `doctor.ts`: WP01A → WP03
   - `stories.ts` and `tasks.ts` services: WP01B → WP02C → WP05C
2. **Consumer compile-fix rule.** A framework package that changes a signature updates **every** caller so that the build compiles. Those callers include built-in plugins, fixtures, and tests. The updates are the minimal mechanical edits only. Plugin-specific behavior changes belong to the plugin's package. List these touched files in the PR body under "Consumer compile fixes".
3. **`src/services/plugins/types.ts`, `src/services/types.ts`, and the `src/plugin-api/*` barrels** are edited by WP04A and WP04B. WP04A publishes, in one pass, every signature that later packages consume. The list is in its package file. A few later packages hold an explicit **type grant** for named blocks, listed in their package files:

- WP01A: stage contexts and views;
- WP01B: the plugin-operation result finalizer;
- WP05A: the `PluginStoryForm` / `PluginStoryFilter` / form-field blocks;
- WP05B: `PluginUi` navigation and the screen-props and route-metadata blocks. Any other package that needs a type change posts a Contract Change Request ([worker.md §4](worker.md#4-contract-change-request-ccr)).
4. **`docs/PLUGINS.md`, `docs/ARCHITECTURE.md`, `docs/agents/CONTEXT.md`, `docs/agents/CONTEXT-MAP.md`, plugin `CONTEXT.md` files, and existing ADRs** are edited only by WP09A, WP09B, and WP10A. WP00 creates **new** ADR files only. Every other package writes a **Docs handoff** section in its PR body. The exception is a glossary fix needed to keep `test/e2e/language.test.ts` passing; make that fix and note it.
5. **[findings.md](findings.md):** each package edits only its own rows.
6. **Tests:** a package owns the test files it creates, plus the existing suites listed in its package file. Shared helpers (`test/helpers/**`, `test/plugins/helpers.ts`, `test/plugins/tuiHelpers.tsx`, `vitest.config.ts`) belong to WP07A, and later to WP07B. Other packages may *add* helper functions, but must not change existing ones.

## 9. Open decisions

### Settled by WP00 (record them in the ADRs; the defaults apply unless WP00 justifies otherwise)

| ID | Decision | Default |
| --- | --- | --- |
| W1 | Operation verbs and layout uniformity (CQ-04/05/06) | Keep the current verbs, layouts, and delete-result shapes. Status `deferred: keep per WP00`. |
| W2 | Lock mechanism | An exclusive-create lock file under the Data Root, with the owner's pid, host, and start time. A bounded wait of about 10 s. Stale if the owner pid is dead on the same host, or the lock is older than a documented maximum. |
| W3 | Journal | `.rowbly/.txn/<id>/` holding `manifest.json` and staged content. Roll forward once the manifest is marked prepared. Restore originals otherwise. Gitignored. |
| W4 | Durability | Process-death durability, with fsync of staged files and the manifest. Directory fsync where the platform supports it. State it explicitly. |
| W5 | Symlink policy (RES-21, SEC-02) | Trusted filesystem. A symlinked Data Root is allowed. Symlinks **inside** plugin scopes (on the parent path or the final file) are rejected for read, write, list, and delete. Not claimed to be race-proof. |
| W6 | Repeated replacement `core()` | Call-once. A second call throws an attributed `PluginError` and saves nothing. |
| W7 | Reaction deadline | 5 s per reaction, configurable for tests. On timeout: warn with the plugin and operation, then continue with later reactions. No rollback. |
| W8 | Plugin-only link changes bump the Story's `updatedAt` (CQ-19, DX-38) | Yes, but only when the bag actually changes, and using the operation clock. |
| W9 | Comment body whitespace (UI-02) | Preserve the raw text on both surfaces. Reject whitespace-only bodies in the service. |
| W10 | Late registration failure (RES-22, ARCH-24) | Whole-plugin skip. Name claims are reconciled within a single activation sequence. A later plugin that was rejected before a late failure is not retried in the same run; document this as a deterministic policy. |
| W11 | Transform removes the returned entity (§6) | Fail before save with an attributed `ConflictError`. |
| W12 | Replacements | Keep them as a tested, advanced, supported capability. Move them out of the beginner guide. |

### Asked of the user at Checkpoint A (the supervisor proceeds on the default if the user says so)

| ID | Question | Recommended default |
| --- | --- | --- |
| U1 | Is historical pre-plugin data supported (core Comments and old Epic files)? (VER-03) | **No importer.** WP03 adds a targeted raw-JSON legacy diagnostic, flagged before any write strips it. WP09B documents backup and upgrade behavior. |
| U2 | The supported data-size envelope (PERF-01) | Roots of up to about 5,000 Stories per Board are supported. PERF-01 is therefore a release gate and is done in WP08A. |
| U3 | Is a third-party plugin launch in scope for this effort? | **No.** WP10A writes the policies. WP10B is deferred unless the user says yes at Checkpoint C. |
| U4 | Should the TUI show a force-delete path for Boards blocked only by plugins (UI-01)? | **Yes**, via the machine-readable `canForce` signal, without bypassing arbitrary guards. |

## 10. Keep as-is (do not regress)

- The pipeline order: replacement or core → transforms → guards → save → reactions. Replacement `core()` passes errors through. Reactions run in the background in the TUI, are awaited in the CLI, and only warn on failure.
- Record-level Change Sets. Tasks stay inside Stories and Assignees stay inside the root config. Keep before/after changes, registry ordering, and whole-folder Story renumbering.
- The file and bag layout: `plugins/<id>/` at root, Board, and Story scope, and the keys `plugins.epics.epic`, `plugins.specs.specs`, `plugins.comments.comments`. No new envelope and no renaming.
- Opaque preservation of unknown and disabled bags. Explicit bag removal. Other plugins' entries left intact.
- Data Root enablement. The Board settings cascade, where objects merge and arrays replace. Raw settings kept for preservation, parsed settings used for behavior.
- The static built-in registry with lazy TUI imports. The CLI never evaluates Ink or React component modules. Core never imports a built-in plugin domain, as the architecture tests enforce.
- Load-time failure isolation: a plugin whose settings, start, CLI, or TUI load fails is skipped and its data is kept. Unknown enabled IDs are reported. Doctor distinguishes failed, invalid, and unchecked data.
- A throwing doctor fix aborts its current unsaved pass (this is consistent with ADR-0012). Keep it.
- Relative-name checks on plugin files. They reject traversal and absolute paths, and stay in place alongside any symlink policy.
- Strict core bag shape: a non-object bag is `SCHEMA_INVALID`. Do not loosen it.
- The `--json` error shape `{"error":{"code","message","details","hint"}}`.
- `definePlugin` as a typed identity, along with its working settings inference. A guard `guard() {}` with no explicit return compiles.
- The fixture plugins (Notes, Stamp, Boom, Strict) and the end-to-end built CLI and TUI coverage. Replacements, start, settings links, and the advertised bag scopes remain even though no built-in uses them.
- Injected clock and ID generation. Explicit `cli.run` adapters. Small helpers local to each plugin.

## 11. Not adopted — do not build

- SQLite or any database. A general transaction DSL. A distributed lock service. A per-plugin transaction manager.
- Persistent stable IDs on every Story or Board. Structural repair followed by a fresh analysis solves RES-09.
- A generic event bus, a DI framework, a global async task registry, or deadlines around every hook and UI API.
- A worker or process sandbox, or a permission UI.
- Automatic or silent migration of unknown or future data at startup or by doctor. Treating invalid data as empty.
- Blanket wrapping of expected errors into `INTERNAL` with a disable hint.
- A global file, bag, or parse cache, or process-wide memoization. Caches are operation-scoped, with a defined invalidation.
- A mandatory `storyFields` DSL, operation-schema registry, typed screen registry, generic `<Async>` component, shell `ui.confirm()` service, nullable-select API, or key dispatcher. Each of these is optional in its own finding, and only when evidence supports it.
- A rename of the Comments verbs, or a uniform CRUD renaming, unless W1 chooses it.
- A runtime UI import into `src/services`. Type-only imports are fine (ARCH-01).
- Making shipped built-in glossaries optional. A `trustedPlugins` config key. A mandatory `core()` call in replacements. Stripping unknown settings by default.
- Machine-dependent timing thresholds in CI.

## 12. Regression test inventory

Each P0 or P1 reproduction becomes a permanent test in the package shown. The file names are the ones the review proposed; adjust them only if an existing suite fits better. Use barriers, not sleeps, to make concurrency deterministic.

| Reproduction / finding | Test file | Package |
| --- | --- | --- |
| `r02-reentrancy` RES-05, ARCH-06 | `test/plugins/reentrancy.test.ts` | WP01A |
| `extra.ts` deletion-target mutation RES-06, ARCH-39 guard mutation probe, ARCH-23 | `test/plugins/changeSetIsolation.test.ts` | WP01A |
| RES-15 `r18` hang | `test/plugins/reactionTimeout.test.ts` | WP01B |
| RES-16, OBS-02, DX-39, ARCH-04 | `test/plugins/cliFailureAttribution.test.ts` | WP01B |
| RES-18B | `test/plugins/asyncFailure.test.ts` | WP01B |
| `text-failure.ts` RES-03 | `test/storage/textAtomicity.test.ts` | WP02B |
| `r04` / `r14` RES-04 | `test/plugins/moveRecovery.test.ts` (engine part: `test/storage/transaction.test.ts`) | WP02B (engine), WP02A (integration) |
| `extra.ts` resurrection RES-08, ARCH-38 probes | `test/plugins/deletedScopes.test.ts` | WP02A |
| `move-file.ts` RES-10, `crosscheck` RES-24 | `test/plugins/fileScopeChanges.test.ts` | WP02A |
| `r03-partial-save` RES-01, ARCH-41 | `test/plugins/transactionFailure.test.ts` | WP02A (injection), WP02C (subprocess kill) |
| `r01-concurrent-create` RES-02 | `test/plugins/concurrency.test.ts` (real CLI subprocesses) | WP02C |
| `r05-orphan-adoption` RES-07 | `test/plugins/orphanFolders.test.ts` | WP02C (allocation), WP03 (diagnosis) |
| `r10-prefix-cache` RES-19 | `test/storage/repositoryFreshness.test.ts` | WP02C |
| ARCH-37 local-bag probe | `test/plugins/localStateFreshness.test.ts` | WP02C |
| `more.ts` RES-21 symlinks | `test/plugins/filePaths.test.ts` | WP02B |
| `r06-doctor-stale-key` RES-09 | `test/plugins/doctorIdentity.test.ts` | WP03 |
| `more.ts` RES-17 | extend `test/plugins/doctor.test.ts` | WP03 |
| `r13-invalid-bag-dropped` RES-11, DX-09 | `test/plugins/invalidBagPreservation.test.tsx` | WP05A |
| `r07-corrupt-epic-file` RES-12 (UI) | `test/plugins/tuiFailureIsolation.test.tsx` | WP05A (fields), WP05B (render) |
| `r07` RES-12 (doctor) | `test/plugins/epicsCorruption.test.ts` | WP08A |
| `extra.ts` RES-13 boundary | `test/plugins/tuiFailureIsolation.test.tsx` | WP05B |
| RES-18C | `test/tui/useAsync.test.tsx` | WP05B |
| ARCH-43 | `test/services/combinedEdit.test.ts` + TUI form tests | WP05C |
| `extra.ts` RES-14, `crosscheck` RES-22/25 | `test/plugins/registrationFailure.test.ts`, `test/plugins/load.test.ts` | WP06 |
| RES-18A | `test/plugins/moduleFailure.test.ts` (build/startup smoke at minimum) | WP06 |
| `crosscheck` RES-11 Comments, ARCH-36 probe | `test/plugins/comments.test.ts` | WP08C |
| Specs invalid links | `test/plugins/specs.test.ts` | WP08B |
| UI-01 | Board TUI + CLI force tests | WP08B |
| UI-02 | Comments CLI/TUI whitespace parity | WP08C |
