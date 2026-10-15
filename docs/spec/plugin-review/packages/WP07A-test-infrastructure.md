# WP07A — Test infrastructure & suite hygiene

**Depends on:** WP05O · **Wave:** 0 · **Priority:** P1 (failure-test enablers) / P2
**Review sources:** [README WP07](../../../reviews/plugin-architecture/README.md#wp07); [ARCH-29](../../../reviews/plugin-architecture/general-architecture.md#arch-29); [TEST-02–04](../../../reviews/plugin-architecture/other-areas.md#test-02); [CQ-136–157](../../../reviews/plugin-architecture/code-quality.md#cq-136).

## Goal

Give every later package a dependable test base:

- isolated build artifacts, so parallel worktrees and runs don't delete each other's CLIs;
- a production-like plugin TUI harness;
- navigation helpers that look for fields by meaning;
- no timing sleeps;
- a CLI/TUI parity checklist.

Clean up the small test findings while touching these files.

## Owns

- `test/helpers/globalSetup.ts`, `test/helpers/runCli.ts`, `vitest.config.ts`, `tsup.config.ts` (test-related output paths only)
- `test/plugins/helpers.ts`, the new `test/plugins/tuiHelpers.tsx`, `test/plugins/fixtures/**`
- the existing plugin suites `test/plugins/*.test.ts(x)`, for CQ-136–156 edits only (setup, helper, cast, and sleep fixes; no behavior assertions removed)
- `test/architecture.test.ts` (CQ-157, optional)
- new `test/plugins/relativeTime.test.ts`
- new `test/plugins/PARITY.md`, or an equivalent `parityCases.ts`, for TEST-04

## Deliverables

1. **ARCH-29: per-run build isolation.** Build the main CLI and the fixture CLI into per-run temporary directories. Pass the paths through Vitest's provided context (`provide`/`inject`), and clean up only the directories this run owns. A lock is acceptable only if it covers the build **and** the entire consuming suite. Never claim that concurrency caused the historical failures.
2. **TEST-03:** a focused Vitest project or config that runs service and TUI tests without the CLI global setup. Attach the build only to suites that call `runCli`. Document the command in the PR's Docs handoff.
3. **TEST-02 / CQ-136:** `test/plugins/tuiHelpers.tsx` with `openPluginApp(t, registry, initial, ctxOverrides?)` returning `{ app, ctx, services, host, toasts }`. Context warnings go to the same displayed ToastStore. Background reactions are on. The reload loader is supplied as in production. Migrate `tui.test.tsx`, `epicsTui.test.tsx`, `specsTui.test.tsx`, and `commentsTui.test.tsx` onto it. Any loader-less test must be deliberate and named.
4. **CQ-137:** `focusFormField(app, label)` and a bounded list-item helper. Each matches the focused-row marker from `Form.tsx`, and fails with the last frame after a bounded number of tries. Replace the magic `Array(n).fill(KEYS.tab)` and repeated `j` sequences, except where the key sequence is itself what's under test.
5. **TEST-04:** a compact mutation × surface checklist, using the [other-areas matrix](../../../reviews/plugin-architecture/other-areas.md#clitui-consistency-findings) as its starting point. Mark UI-01 and UI-02 as owned by WP08B and WP08C, which add those tests. Don't build a test DSL.
6. **Small suite fixes:** CQ-140, CQ-141 (no `as never` cast), CQ-142 (merged into CQ-136; it goes away with the harness), CQ-145, CQ-146, CQ-152 (move the pure `relativeTime` cases into their own suite), CQ-153, CQ-154 (stale fixture comment, order-reset note), CQ-155, and CQ-156. CQ-139 and CQ-151 are withdrawn: keep the recorders and the separate Doctor suite. Some notes:
   - CQ-140: `readCommentThread` parses with `CommentsBag`. It returns `[]` only when the bag is absent and fails on invalid data.
   - CQ-153: replace the 10 ms sleep with an explicit `reacted` promise. WP01B may rewrite this test later.
   - CQ-155: the Notes fixture throws `ValidationError` for a **supplied** invalid value. Absent input stays a no-op.
   - CQ-146: use the ENOENT-only `pathExists` from `src/storage`.
7. **Optional:**
   - CQ-138 `rejectingPlugin` for **static** guards only.
   - CQ-143 shared `reservedNames()`.
   - CQ-144 `runPluginCli`, only if executables and cwd stay explicit.
   - CQ-147, CQ-148, CQ-149 (keep per-character input events), CQ-150.
   - CQ-157 cross-area import rule, now that WP05O has merged.

   Evaluate each, then implement it or defer it with a reason.

## Acceptance criteria

- [ ] Two `pnpm test` runs in separate processes or worktrees at the same time cannot delete each other's CLI bundles. Show this in the PR, for example with two concurrent runs.
- [ ] A filtered service or TUI test runs without invoking tsup. CLI suites still build from current source.
- [ ] All four plugin TUI suites use `openPluginApp`. A plugin warning appears in both the collector and the rendered toasts.
- [ ] Inserting a dummy core field before a plugin field (try it locally) doesn't break unrelated plugin tests. An absent target fails with a diagnostic instead of hanging.
- [ ] No timer sleeps remain in the plugin suites.
- [ ] The parity checklist exists and lists every built-in mutation with its CLI and TUI test, or a supported exception.
- [ ] Test count is ≥ baseline. No assertion was removed except as part of moving it.

## Findings

26 rows. Record final statuses in [findings.md](../findings.md#wp07a).

| Finding | Priority | Disposition | Issue | Required outcome |
| --- | --- | --- | --- | --- |
| [ARCH-29](../../../reviews/plugin-architecture/general-architecture.md#arch-29) | P2 | Recommended / see scope | Simultaneous test runs share build outputs | Required. |
| [CQ-136](../../../reviews/plugin-architecture/code-quality.md#cq-136) | P2 | Useful | Four TUI setup helpers exercise different integration semantics. | Required. |
| [CQ-137](../../../reviews/plugin-architecture/code-quality.md#cq-137) | P2 | Useful | Magic navigation counts bind tests to unrelated field order. | Required. |
| [CQ-138](../../../reviews/plugin-architecture/code-quality.md#cq-138) | Optional | Optional | Guard-only fixtures at test/plugins/epics.test.ts:115, specs.test.ts:82, pipeline.test.ts:222, doctor.test.ts:52, epicsDoctor.test.ts:34 repeat small definitions. Optional rejec… | Evaluate; implement only if the entry's condition holds, else `deferred: <reason>`. |
| [CQ-139](../../../reviews/plugin-architecture/code-quality.md#cq-139) | Optional | Optional; original diagnosis withdrawn | Recorder fixtures at test/plugins/pipeline.test.ts:13/:182 and comments.test.ts:77 use Object.fromEntries with structurally compatible common event subsets. Original claim they … | Evaluate; implement only if the entry's condition holds, else `deferred: <reason>`. |
| [CQ-140](../../../reviews/plugin-architecture/code-quality.md#cq-140) | P2 | Useful | test/plugins/commentsCli.test.ts:15 and commentsTui.test.tsx:31 read/cast raw thread data. Add readCommentThread(t: TempRoot, key: string, taskIndex?: number): Promise<Comment[]… | Required. |
| [CQ-141](../../../reviews/plugin-architecture/code-quality.md#cq-141) | P2 | Useful | test/plugins/load.test.ts:54: host.failures()[0] as never suppresses indexed-access uncertainty. Replace with host.failures().map(failureWarning)[0] in the assertion, or explici… | Required. |
| [CQ-142](../../../reviews/plugin-architecture/code-quality.md#cq-142) | See linked finding | Merged; see local fallback | test/plugins/tui.test.tsx:39: ctx.plugins as NonNullable<RowblyContext['plugins']>. Keep const host = await load(t) and call loadTuiPlugins(host), assigning host to ctx. | None separately — resolved by CQ-136. |
| [CQ-143](../../../reviews/plugin-architecture/code-quality.md#cq-143) | Optional | Optional | test/plugins/helpers.ts:48, tui.test.tsx:18/:47, epicsTui.test.tsx:34 and load.test.ts:10 rebuild static reserved command/key metadata. Optional const reserved = reservedNames()… | Evaluate; implement only if the entry's condition holds, else `deferred: <reason>`. |
| [CQ-144](../../../reviews/plugin-architecture/code-quality.md#cq-144) | Optional | Optional | test/plugins/cli.test.ts:6/:9, epicsCli.test.ts:5/:6, specsCli.test.ts:7/:9, commentsCli.test.ts:11: tiny CLI/JSON wrappers repeat. Their executable/cwd options differ. Share on… | Evaluate; implement only if the entry's condition holds, else `deferred: <reason>`. |
| [CQ-145](../../../reviews/plugin-architecture/code-quality.md#cq-145) | P2 | Useful | test/plugins/cli.test.ts:11 async root only awaits/returns pluginRoot; replace calls directly. :55/:58 dynamically imports fs for ordinary test helpers; import mkdir/readFile on… | Required. |
| [CQ-146](../../../reviews/plugin-architecture/code-quality.md#cq-146) | Optional | Optional / useful | test/plugins/pipeline.test.ts:303–:314: late helper declarations are legal, not a control-flow bug. Local pathExists suppresses all I/O errors; replace it with src/storage expor… | Evaluate; implement only if the entry's condition holds, else `deferred: <reason>`. |
| [CQ-147](../../../reviews/plugin-architecture/code-quality.md#cq-147) | Optional | Optional | test/plugins/specsCli.test.ts:95: one test sits outside the file's describe; :7 uses Parameters<typeof runCli>[1]. Optional move into describe('rowbly specs') and import existin… | Evaluate; implement only if the entry's condition holds, else `deferred: <reason>`. |
| [CQ-148](../../../reviews/plugin-architecture/code-quality.md#cq-148) | Optional | Optional / useful | test/plugins/specsTui.test.tsx:135 loop-generated tests could use it.each; test/plugins/comments.test.ts:36 combines null/stranger author cases inside one test. Parameterize Com… | Evaluate; implement only if the entry's condition holds, else `deferred: <reason>`. |
| [CQ-149](../../../reviews/plugin-architecture/code-quality.md#cq-149) | Optional | Optional / useful | test/plugins/specsTui.test.tsx:51/:77/:129 lists characters; Comments spreads a string; Epics passes words. A whole string to app.press produces one input event, unlike characte… | Evaluate; implement only if the entry's condition holds, else `deferred: <reason>`. |
| [CQ-150](../../../reviews/plugin-architecture/code-quality.md#cq-150) | Optional | Optional | test/plugins/epics.test.ts:41: ctx.now = ... differs from fixedClock().advance in Comments. Optional inject a retained fixedClock in setup and advance it. Mutating the test cloc… | Evaluate; implement only if the entry's condition holds, else `deferred: <reason>`. |
| [CQ-151](../../../reviews/plugin-architecture/code-quality.md#cq-151) | None | Withdrawn | test/plugins/epicsDoctor.test.ts:1 is separate while specs.test.ts:111 groups Doctor tests. Both are cohesive organizations; no reason to force a merge. | None — withdrawn by the review. Do not implement the original prescription; any residual note in the package is optional. |
| [CQ-152](../../../reviews/plugin-architecture/code-quality.md#cq-152) | P2 | Useful | test/plugins/commentsTui.test.tsx:91: pure relativeTime cases live in an integration suite. Move unchanged cases to test/plugins/relativeTime.test.ts importing only the helper. | Required. |
| [CQ-153](../../../reviews/plugin-architecture/code-quality.md#cq-153) | P2 | Useful | test/plugins/pipeline.test.ts:157: 10ms sleep after releasing a reaction. Microtask ordering makes a failure unlikely here; prior “cannot flake” language overclaimed. Use an exp… | Required. |
| [CQ-154](../../../reviews/plugin-architecture/code-quality.md#cq-154) | P2 | Useful / optional | test/plugins/fixtures/others.ts:86: “like Specs will” is stale now that Specs exists; change to “like Specs”. Exported order state is intentionally reset at pipeline.test.ts:42;… | Required (optional sub-parts per entry). |
| [CQ-155](../../../reviews/plugin-architecture/code-quality.md#cq-155) | P2 | Useful | test/plugins/fixtures/notes.ts:32: if (!parsed.success \/\/ !key) return silently ignores supplied malformed input; docs docs/PLUGINS.md:306 points authors to fixtures. Preserve… | Required. |
| [CQ-156](../../../reviews/plugin-architecture/code-quality.md#cq-156) | P2 | Useful | test/plugins/doctor.test.ts:11: join(root, path, '..') works but dirname(join(root, path)) makes parent intent explicit. test/plugins/bags.test.ts:78 casts story.tasks; parse wi… | Required. |
| [CQ-157](../../../reviews/plugin-architecture/code-quality.md#cq-157) | Optional | Optional | test/architecture.test.ts:1 enforces layers/imports, not AGENTS.md component naming/barrels. After CQ-73/CQ-74, optionally add a focused cross-area import rule using the test's … | Evaluate; implement only if the entry's condition holds, else `deferred: <reason>`. |
| [TEST-02](../../../reviews/plugin-architecture/other-areas.md#test-02) | P2 | Recommended / see scope | Repeated TUI setup wires warning delivery differently | Required. |
| [TEST-03](../../../reviews/plugin-architecture/other-areas.md#test-03) | Optional | Optional / bounded | Single in-process test runs build both CLI bundles | Evaluate; implement only if the entry's condition holds, else `deferred: <reason>`. |
| [TEST-04](../../../reviews/plugin-architecture/other-areas.md#test-04) | P2 | Recommended / see scope | No explicit checklist ties each mutation to both surfaces | Required. |
