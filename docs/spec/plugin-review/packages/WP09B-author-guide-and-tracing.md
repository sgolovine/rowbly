# WP09B — Author guide, API reference & tracing

**Depends on:** WP02C, WP03, WP04B, WP05B, WP05C · **Gate:** ✱B · **Wave:** 5 · **Priority:** P2 (the trust and error documentation goes with the P1 behavior)
**Review sources:** [README WP09](../../../reviews/plugin-architecture/README.md#wp09); [DX-03](../../../reviews/plugin-architecture/straightforwardness-for-plugin-authors.md#dx-03), [DX-04](../../../reviews/plugin-architecture/straightforwardness-for-plugin-authors.md#dx-04), [DX-05](../../../reviews/plugin-architecture/straightforwardness-for-plugin-authors.md#dx-05); [DOC-03](../../../reviews/plugin-architecture/other-areas.md#doc-03), [DOC-04](../../../reviews/plugin-architecture/other-areas.md#doc-04); [OBS-01](../../../reviews/plugin-architecture/other-areas.md#obs-01); [ARCH-35](../../../reviews/plugin-architecture/general-architecture.md#arch-35); [CQ-159–164](../../../reviews/plugin-architecture/code-quality.md#cq-158).

## Goal

Document the **final** contracts so that a new reader can describe the actual persistence model and can write and test a minimal plugin from the docs alone. Add a small opt-in operation trace. Consume every Docs handoff the supervisor collected from earlier PRs.

## Owns

- `docs/PLUGINS.md`, `docs/ARCHITECTURE.md`
- new `docs/WRITING-A-PLUGIN.md` (tutorial) and `docs/plugins/API.md` (reference), or equivalent sections. Choose one structure and link it from `README.md`'s Plugins section and from `docs/PLUGINS.md`.
- JSDoc in `src/services/plugins/types.ts` and `src/plugin-api/**` (DOC-04). Comments only; any type change needs a CCR.
- `README.md`: the Plugins section only
- `test/e2e/language.test.ts`: the DX-05 hardening
- tutorial compile and run checks, for example `test/docs/tutorial.test.ts` with the example kept under `test/docs/fixtures/`
- OBS-01: `src/services/plugins/runtime.ts` and `src/main.ts`, for the trace hook only, plus a new `src/services/plugins/trace.ts`

## Deliverables

1. **Tutorial (DX-03, DX-05, DOC-03).** Follow this order:
   1. supported scope and imports;
   2. the five-line hello-world row;
   3. running and enabling it;
   4. a complete editable field (the Points example rewritten against the final API);
   5. commands;
   6. metadata-only TUI fields;
   7. lazy component screens;
   8. the operation lifecycle;
   9. files, doctor, and settings;
   10. tests (using the WP07B harness);
   11. advanced replacements.

   Add the built-in checklist: folder and definition, registry entry, a meaningful glossary plus map link, enablement, and allowed imports. The examples compile and run in CI. Repository-only steps are clearly separated from future external installation (WP10B).
2. **Reference (DX-04, DOC-04).** Cover:
   - public exports;
   - supported operation names, using WP04B's inventory;
   - the stage/capability table;
   - stored versus pending reads;
   - the D7 error policy;
   - the D6 bag states and the dirty/clear truth table, including zero, `false`, and `[]`;
   - CLI attribute naming with an example table (absent → `undefined`, paired negation → `false`, value → string, repeatable → string array);
   - reserved route metadata and screen params;
   - focus and active rules;
   - failed-plugin behavior;
   - transaction guarantees (contracts §7) and their limits for external tools;
   - migration rules (from WP10A);
   - the replacement contract (W6, W12).

   Remove `pluginInput as object` (CQ-160). Show `safeParse` or schema validation instead.
3. **Settings (ARCH-35, DX-35).** Document manual editing of root and Board settings, replace/merge semantics, reload behavior, and `plugins show` (raw versus effective). Explain how to supply a required setting and enable the plugin. Manual edits preserve `enabled`.
4. **CQ-159 / CQ-161 / CQ-162 / CQ-163 / CQ-164.** Document the final repeatable-parsing route. List the type-only `Command` export and the final hook-error semantics. Use a relative link for `CORE_KEYS`. Make sure the documented hook names match the recorder tests, and that the CLI placeholders match `--help`.
5. **DX-05, glossary audit hardening.** `pluginAvoidWords()` skips regex creation when there are no `_Avoid_` words, or reports a precise glossary error. Decide whether non-plugin helper directories are ignored. Don't weaken the project's language policy.
6. **OBS-01, opt-in trace.**
   - One switch: `ROWBLY_DEBUG=trace`, or a `--debug` global if WP06 agrees through a CCR.
   - It records the operation ID, plugin ID, stage, elapsed time, outcome, and root-relative affected paths or counts.
   - It writes to stderr in the CLI, and to a bounded sink in the TUI (not toasts).
   - When disabled, it does no serialization or allocation.
   - It never records bodies, bags, settings, editor text, or secrets.
   - JSON stdout stays parseable.
7. **Final pass over [contracts.md](../contracts.md) §7 and the ADRs.** Make sure the docs, the ADR status notes, and `docs/agents/CONTEXT-MAP.md` agree with the merged behavior. Fix any `<!-- WP09B -->` markers left by WP09A.

## Acceptance criteria

- [ ] A reader can describe the persistence and transaction model, and can write and test a minimal plugin from the docs alone. Every documented command and import works. The tutorial compiles and runs in CI (DX-03, DOC-03).
- [ ] The examples contain no unchecked bag writes, distinguish create-empty from edit-clear, and preserve zero and `false` (DX-04).
- [ ] A missing or empty glossary gives an intelligible result (DX-05).
- [ ] With tracing on, a failing hook can be located by plugin and stage. JSON output still parses, and no private payload is logged (OBS-01).
- [ ] The domain glossaries and `docs/agents/CONTEXT-MAP.md` agree with the current built-ins.
- [ ] Every Docs handoff collected in `.fleet/plugin-review-status.md` is applied or explicitly rejected with a reason in the PR.

## Findings

13 rows. Record final statuses in [findings.md](../findings.md#wp09b).

| Finding | Priority | Disposition | Issue | Required outcome |
| --- | --- | --- | --- | --- |
| [ARCH-35](../../../reviews/plugin-architecture/general-architecture.md#arch-35) | Optional | Optional / bounded | Plugin settings have no generic in-app write surface | Evaluate; implement only if the entry's condition holds, else `deferred: <reason>`. |
| [CQ-159](../../../reviews/plugin-architecture/code-quality.md#cq-159) | P2 | Useful / optional | docs/PLUGINS.md:284 describes cli.parseRepeatable; it works in Plugin command callbacks but is unavailable to core-attached options.input (types.ts:330). Narrow the explanation … | Required (optional sub-parts per entry). |
| [CQ-160](../../../reviews/plugin-architecture/code-quality.md#cq-160) | P2 | Useful | docs/PLUGINS.md:229/:231: created-Story search plus pluginInput as object teaches unchecked bag input. Show a concrete schema, skip undefined, safeParse/validate supplied input,… | Required. |
| [CQ-161](../../../reviews/plugin-architecture/code-quality.md#cq-161) | Optional | Optional / useful | docs/PLUGINS.md:284 already says cli.run prints warnings/errors like core; types.ts:295 explicitly discusses exit codes. The original blanket missing-error-description claim is … | Evaluate; implement only if the entry's condition holds, else `deferred: <reason>`. |
| [CQ-162](../../../reviews/plugin-architecture/code-quality.md#cq-162) | Optional | Optional | docs/PLUGINS.md:172 references CORE_KEYS by source path. Authors reading it is a valid reference strategy. Optional make it a clickable relative link after CQ-76; don't duplicat… | Evaluate; implement only if the entry's condition holds, else `deferred: <reason>`. |
| [CQ-163](../../../reviews/plugin-architecture/code-quality.md#cq-163) | See linked finding | Merged | docs/PLUGINS.md:153/:169 accurately list current Comments/Epics operations. Update only after the supervisor's chosen verb contract/CQ-05 lands. | None separately — resolved by CQ-05. |
| [CQ-164](../../../reviews/plugin-architecture/code-quality.md#cq-164) | See linked finding | Merged; see local fallback | docs/PLUGINS.md:134/:136: <t>/<md> placeholders are currently accurate. Update with CQ-116 if that cosmetic choice is adopted. | None separately — resolved by CQ-116. |
| [DOC-03](../../../reviews/plugin-architecture/other-areas.md#doc-03) | P2 | Recommended / see scope | Writing guide lacks a complete executable tutorial/reference | Required. |
| [DOC-04](../../../reviews/plugin-architecture/other-areas.md#doc-04) | P2 | Recommended / see scope | Public JSDoc leaves lifecycle/ownership contracts underspecified | Required. |
| [DX-03](../../../reviews/plugin-architecture/straightforwardness-for-plugin-authors.md#dx-03) | P2 | Recommended / see scope | Author instructions begin with architecture rather than a runnable progression | Required. |
| [DX-04](../../../reviews/plugin-architecture/straightforwardness-for-plugin-authors.md#dx-04) | P2 | Recommended / see scope | The guide needs precise boundary examples, not wholesale replacement | Required. |
| [DX-05](../../../reviews/plugin-architecture/straightforwardness-for-plugin-authors.md#dx-05) | P2 | Recommended / see scope | There is no minimal complete hello world, and built-in integration needs a checklist | Required. |
| [OBS-01](../../../reviews/plugin-architecture/other-areas.md#obs-01) | P2 | Recommended / see scope | No opt-in successful-operation/hook trace | Required. |
