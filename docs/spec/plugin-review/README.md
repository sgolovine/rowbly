# Rowbly plugin architecture remediation — Build Spec

This folder turns the [plugin architecture review](../../reviews/plugin-architecture/README.md) into executable work for a **supervisor + fleet of worker agents** running in T3 Code. It covers every finding in the review: all 306 entries of the [finding index](../../reviews/plugin-architecture/finding-index.md). RES-18 is split into its three documented subcases, so the ledger has 308 rows.

| File | Audience | Purpose |
| --- | --- | --- |
| [README.md](README.md) | everyone | Goal, priorities, package graph, waves, checkpoints, global Definition of Done |
| [contracts.md](contracts.md) | everyone | Binding decisions, phase/capability rules, data-preservation and error contracts, shared-file ownership, open decisions, non-goals |
| [supervisor.md](supervisor.md) | supervisor | Runbook: dispatch, review, merge, checkpoints, ledger |
| [worker.md](worker.md) | workers | Rules of engagement, finding-status protocol, Definition of Done |
| [findings.md](findings.md) | everyone | The ledger: every finding → its package, priority, disposition, required outcome, and status |
| [packages/](packages/) | one worker each | 23 work packages |

**Source evidence.** Each finding links to its detailed entry in `docs/reviews/plugin-architecture/`. That entry holds the evidence, source locations, recommended change, acceptance criteria, and reproduction. Workers **must** read the linked entry for every finding in their package. The package files describe what to build and in what order. The detailed reports describe why and how to verify it. The reproduction scripts are archived in [`repros/`](../../reviews/plugin-architecture/repros/README.md).

**Line numbers** in the review refer to commit `5b3acd475968ad5577bdb0a2008f7f46be3639de`. Always inspect the current source before you edit. Earlier packages will have moved code.

Also binding: [`/AGENTS.md`](../../../AGENTS.md) (TUI organization, checks), [`docs/agents/CONTEXT.md`](../../agents/CONTEXT.md), [`docs/agents/CONTEXT-MAP.md`](../../agents/CONTEXT-MAP.md) and each plugin's `CONTEXT.md` (use the glossary terms and never the `_Avoid_` words), and [`docs/adr/`](../../adr/). Do not reverse an ADR without the user, except through the amendments that WP00 records, which this spec authorizes.

## 1. Goal and scope

Keep Rowbly's architecture:

- a small core,
- built-in plugins behind a public API,
- one service operation pipeline for both CLI and TUI,
- namespaced data,
- plugin files beside their owners.

Make its boundaries enforceable and its data handling safe. Concretely:

1. **Data integrity (P0).** An operation commits completely or not at all, including after recovery. Concurrent operations never silently lose accepted changes. Hooks cannot nest mutations, redirect deletions, or mutate approved plans. Doctor repairs the intended physical record. Invalid, unknown, or future plugin data survives unrelated edits.
2. **Reliability (P1).** A failure in one plugin's load, render, callback, or reaction is contained, attributed, and documented. Registration is deterministic. Deletion parity holds between CLI and TUI. Caches are correct.
3. **Maintainability and authoring (P2).** Typed plugin inputs and truthful results, narrower contexts, documentation that matches the code, a test harness, and measured performance fixes.
4. **Third-party readiness (P3).** Policies are written now (WP10A). Packaging and loading (WP10B) happen only if the user opts in at Checkpoint C.

Out of scope, per the review: replacing file storage with SQLite or another database, a generic event bus or DI framework, sandboxing untrusted code, implementing the Git plugin (ADR-0016), plugin dependency graphs, and a generic migration engine. See [contracts.md §11](contracts.md#11-not-adopted--do-not-build).

## 2. Priorities

| Priority | Meaning | Release gate |
| --- | --- | --- |
| P0 | Data integrity release blocker | Checkpoint B |
| P1 | Reliability / usable built-in release | Checkpoint C |
| P2 | Authoring and maintainability | Checkpoint C (each finding resolved or deferred with a recorded reason) |
| P3 | Before third-party loading | Only if WP10B is approved |
| Optional | Needs evidence or demand | Evaluate. Implement only if the review's stated condition holds. Otherwise record `deferred` with a reason |

Execution priority in [findings.md](findings.md) is authoritative. A reviewer may have called an item "critical" or "major" within their own area, but that severity does not change its execution priority.

## 3. Work-package graph

```text
Wave 0  WP00 Contracts & ADRs ─────────────── ══ CHECKPOINT A ══
        WP05O TUI organization ──► WP07A Test infrastructure
        WP09A Doc corrections        (after WP00)

Wave 1  WP04A API safety contracts   (after A)
        WP02B Storage commit engine  (after A)

Wave 2  WP01A Execution scopes       ← WP04A
        WP06  Host & CLI             ← WP04A
        WP05A Form preservation      ← WP04A, WP05O

Wave 3  WP01B Callbacks/errors       ← WP01A, WP06
        WP02A Change Set plan        ← WP01A, WP02B
        WP05B TUI containment        ← WP05O, WP01B
        WP02C Coordinated operations ← WP02A, WP01B

Wave 4  WP03  Doctor                 ← WP02C
        WP05C Combined edit          ← WP02C, WP05A
        WP08A Epics                  ← WP02A, WP05A, WP05B
        WP08B Specs                  ← WP02A, WP05A, WP05B, WP01B
        WP08C Comments               ← WP04A, WP01B, WP05B
        ─────────────────────────────── ══ CHECKPOINT B (P0 gate) ══

Wave 5  WP04B Inputs & author API    ← WP06, WP01B, WP05A            (after B)
        WP07B Perf & harness         ← WP04B, WP08A, WP08B           (after B)
        WP09B Guide & tracing        ← WP02C, WP03, WP04B, WP05B, WP05C (after B)
        WP10A Policies               ← WP04B, WP02C                  (after B)
        ─────────────────────────────── ══ CHECKPOINT C (built-in release gate) ══

Wave 6  WP10B External packaging     ← WP10A, WP07B, WP09B           (only if approved at C)
```

The supervisor schedules strictly by the **Depends on** column below. The wave labels are for humans. Run at most **5** workers at once.

| Package | Title | Depends on | Priority | Findings |
| --- | --- | --- | --- | ---: |
| [WP00](packages/WP00-contracts-and-adrs.md) | Contracts & ADRs | — | P0 (enabler) | 3 |
| [WP05O](packages/WP05O-tui-organization.md) | TUI organization pass | — | P2 (enabler) | 4 |
| [WP07A](packages/WP07A-test-infrastructure.md) | Test infrastructure & suite hygiene | WP05O | P1/P2 | 26 |
| [WP09A](packages/WP09A-doc-corrections.md) | Documentation factual corrections | WP00 | P2 | 5 |
| [WP04A](packages/WP04A-api-safety-contracts.md) | Plugin API safety contracts | WP00 ✱A | P0/P1 | 19 |
| [WP02B](packages/WP02B-storage-commit-engine.md) | Storage commit engine | WP00 ✱A | P0 | 3 |
| [WP01A](packages/WP01A-execution-scopes.md) | Execution scopes & immutable views | WP04A | P0 | 9 |
| [WP06](packages/WP06-host-and-cli-registration.md) | Host loading & CLI registration | WP04A | P1 | 33 |
| [WP05A](packages/WP05A-form-preservation.md) | Plugin form data preservation & field isolation | WP04A, WP05O | P0/P1 | 6 |
| [WP01B](packages/WP01B-callbacks-errors-reactions.md) | Callback invocation, error policy, reactions & results | WP01A, WP06 | P1 | 14 |
| [WP02A](packages/WP02A-change-set-plan.md) | Change Set plan: scopes, identities, validation | WP01A, WP02B | P0 | 12 |
| [WP05B](packages/WP05B-tui-containment.md) | TUI containment, activation & navigation | WP05O, WP01B | P1/P2 | 21 |
| [WP02C](packages/WP02C-coordinated-operations.md) | Coordinated operations, recovery & freshness | WP02A, WP01B | P0 | 6 |
| [WP03](packages/WP03-doctor.md) | Identity-safe doctor | WP02C | P0/P1 | 8 |
| [WP05C](packages/WP05C-combined-edit.md) | Combined Story/Task edit operation | WP02C, WP05A | P0 | 2 |
| [WP08A](packages/WP08A-epics.md) | Epics plugin | WP02A, WP05A, WP05B | P1/P2 | 28 |
| [WP08B](packages/WP08B-specs.md) | Specs plugin | WP02A, WP05A, WP05B, WP01B | P0/P1/P2 | 29 |
| [WP08C](packages/WP08C-comments.md) | Comments plugin | WP04A, WP01B, WP05B | P0/P1/P2 | 15 |
| [WP04B](packages/WP04B-inputs-and-author-api.md) | Plugin inputs, parsing & author API | WP06, WP01B, WP05A ✱B | P2 | 39 |
| [WP07B](packages/WP07B-perf-and-harness.md) | Performance budgets & plugin test harness | WP04B, WP08A, WP08B ✱B | P2 | 3 |
| [WP09B](packages/WP09B-author-guide-and-tracing.md) | Author guide, API reference & tracing | WP02C, WP03, WP04B, WP05B, WP05C ✱B | P2 | 13 |
| [WP10A](packages/WP10A-policies.md) | Compatibility, trust & extension policies | WP04B, WP02C ✱B | P3 (docs) | 5 |
| [WP10B](packages/WP10B-external-packaging.md) | External plugin packaging & loading | WP10A, WP07B, WP09B ✱C | P3 | 5 |

✱A, ✱B, ✱C: the package may not be dispatched until the user has approved Checkpoint A, B, or C respectively (see [supervisor.md §6](supervisor.md#6-checkpoints)).

**Critical path:** WP00 → WP04A → WP01A → WP02A → WP02C → WP03 / WP05C → Checkpoint B. WP02B and WP06 → WP01B must run alongside it so that they never become the bottleneck. When slots are scarce, prefer critical-path packages.

**Same-owner chains.** WP01A→WP01B, WP02B→WP02A→WP02C, and WP04A→WP04B each edit one framework area in sequence. The supervisor may hand the next package in a chain to the same worker thread if that thread is idle and its branch has merged. The next package still gets a new branch from `origin/main`.

## 4. Checkpoints

| Checkpoint | When | The supervisor posts | The user decides |
| --- | --- | --- | --- |
| **A** | WP00 merged | The ADRs, the published type signatures, and the open decisions from [contracts.md §9](contracts.md#9-open-decisions) with their recommended defaults | Approves the contracts. Answers U1–U4 (or accepts the defaults) |
| **B** | WP01A, WP02A, WP02B, WP02C, WP03, WP05A, WP05C, WP08B, WP08C merged | The P0 gate report: every P0 reproduction converted into a permanent test, crash/recovery and real cross-process tests passing, and the P0 rows in the ledger closed | Approves moving to Wave 5 |
| **C** | Every package except WP10B merged | The built-in release gate report: the completion checklist (§6), the final ledger, and the list of deferred findings with reasons | Whether to run WP10B, and whether to revisit any deferrals |
| **Done** | WP10B merged, or the user declined it | Final report | — |

The supervisor never pauses a package that does not depend on a pending checkpoint.

## 5. Global Definition of Done (every package PR)

1. `pnpm typecheck`, `pnpm lint`, `pnpm test`, and `pnpm build` pass on the branch, rebased onto the latest `origin/main`.
2. Every acceptance criterion in the package file is met and checked off in the PR body.
3. Every finding row the package owns in [findings.md](findings.md) has a final status: `done`, `deferred: <reason>`, `withdrawn`, or `merged → <ID>`. See [worker.md §5](worker.md#5-finding-status-protocol).
4. Every P0 or P1 behavior change has **failure-path** tests, not only normal-path tests. Each reproduction listed for the package is a permanent regression test (see [contracts.md §12](contracts.md#12-regression-test-inventory)).
5. Regression fixtures preserve unknown or disabled plugin data. Where order or isolation matters, they include more than one plugin.
6. The PR has no repository-wide formatting or renames. Every TUI change follows AGENTS.md: one component per file, area barrels, and a thin `app.tsx`.
7. Shared-file rules in [contracts.md §8](contracts.md#8-shared-file-ownership-and-sequencing) are respected. If the package changes behavior that `docs/PLUGINS.md` describes, the PR body includes a **Docs handoff** section for WP09B.

## 6. Completion checklist (Checkpoint C and Done)

This mirrors the review's integration checklist. The supervisor verifies each item against the integrated `main`.

- [ ] All P0 reproductions are permanent regression tests. Crash-recovery and real cross-process concurrency tests pass.
- [ ] Every final plan is validated in full before any live write. Snapshots cannot redirect original identities or plugin file scopes.
- [ ] Doctor repairs the intended physical record and rescans after structural changes.
- [ ] Unchanged invalid, unknown, and future bags survive core edits and failed plugin-field loading.
- [ ] A failure in a plugin's load, render, callback, or reaction has the documented containment and error semantics.
- [ ] Built-in CLI and TUI operations are equivalent, including forced Board deletion.
- [ ] Every finding in the ledger is resolved or has a recorded deferral with a reason. Overlapping IDs point to one change.
- [ ] Documentation and public compile fixtures describe the final contracts, not the reviewed baseline.
- [ ] `pnpm typecheck`, `pnpm lint`, and `pnpm test` pass on the integrated `main`.
- [ ] If WP10B ran: the published-package compatibility gate and the trust gate pass.
