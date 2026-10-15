# WP09A — Documentation factual corrections

**Depends on:** WP00 · **Wave:** 0 · **Priority:** P2
**Review sources:** [README WP09](../../../reviews/plugin-architecture/README.md#wp09); [DOC-01](../../../reviews/plugin-architecture/other-areas.md#doc-01), [DOC-02](../../../reviews/plugin-architecture/other-areas.md#doc-02), [DOC-05](../../../reviews/plugin-architecture/other-areas.md#doc-05); [ARCH-15](../../../reviews/plugin-architecture/general-architecture.md#arch-15); [CQ-158](../../../reviews/plugin-architecture/code-quality.md#cq-158).

## Goal

Fix documentation that contradicts the **current** source, so that agents and readers stop implementing stale contracts. Describe today's behavior. WP09B later documents the new contracts once they land.

## Owns

- `docs/ARCHITECTURE.md`
- `docs/spec/initial-spec/contracts.md`. The review cites this file as `docs/spec/contracts.md`; it has since moved to `docs/spec/initial-spec/`.
- `docs/PLUGINS.md` (only the sections named below)
- existing ADR files (status notes and supersession links only)
- `docs/agents/CONTEXT.md`, `docs/agents/CONTEXT-MAP.md`, and the plugin `CONTEXT.md` files (DOC-05 wording only)
- `docs/TECHNICAL_DETAILS.md` (optional link)

## Deliverables

1. **DOC-01 / ARCH-15:**
   - In `docs/ARCHITECTURE.md`: remove the SQLite description, `issues` wording, and the absent Stage/Task ownership IDs. State "no Epics in core; Epics are a built-in plugin" and list ADR-0018. Distinguish the required Board record/config from optional cascade fields.
   - In `docs/spec/initial-spec/contracts.md`: remove the core Comment types, service, and arrays. Move the Comments command description into a built-in-plugin subsection that states its enablement. Make the option-capable commands match the `PluginOptionCommand` type. Explain how the approved plugin ADRs amended the "frozen" contract, and add a header marking the file as the historical v1 spec.
   - Search the other docs and the README for stale Comments, Epics, or SQLite references and fix them. The review's list is not exhaustive.
2. **DOC-02:** add dated implementation-status notes:
   - ADR-0012: doctor fixes run through the pipeline. The error policy is amended by ADR-0020.
   - ADR-0013: whole Story folders move.
   - Link both to the WP00 ADRs.

   Keep ADR-0016 explicitly *planned*. In `docs/PLUGINS.md`, separate implemented capabilities from planned ones.
3. **CQ-158:** remove "running git" from the list of current capabilities in `docs/PLUGINS.md`, or mark it planned (ADR-0016).
4. **DOC-05:**
   - An Action can target no particular record (`none`).
   - A Comment's author is Me when identifiable, otherwise null. Fix this in both `docs/agents/CONTEXT-MAP.md` and the Comments glossary.
   - A Spec's title is its first level-one `# ` heading.

   Keep the `_Avoid_` lists. `test/e2e/language.test.ts` must still pass.
5. Do not document behavior that later packages will change, such as the error policy, transactions, or the dirty-form contract. Leave a `<!-- WP09B -->` marker where WP09B will update a section.

## Acceptance criteria

- [ ] The current-architecture docs make no mention of SQLite, core Comments, core Epics, or a Comments service.
- [ ] Every named command, field, and service in the edited docs matches the current types.
- [ ] Readers can tell what is built and what is planned without comparing Git history. ADR rationale is preserved, not rewritten.
- [ ] The glossary wording matches anonymous Comments, no-target Actions, and an H2 that comes before the H1.
- [ ] `pnpm test` passes, including the language audit.

## Findings

5 rows. Record final statuses in [findings.md](../findings.md#wp09a).

| Finding | Priority | Disposition | Issue | Required outcome |
| --- | --- | --- | --- | --- |
| [ARCH-15](../../../reviews/plugin-architecture/general-architecture.md#arch-15) | P2 | Recommended / see scope | Supporting architecture/contracts documentation still describes removed core Comments | Required. |
| [CQ-158](../../../reviews/plugin-architecture/code-quality.md#cq-158) | P2 | Useful | docs/PLUGINS.md:17 says Plugins work through capabilities including “running git”; src/services/plugins/types.ts:241's PluginContext has no such capability and the Git Plugin is… | Required. |
| [DOC-01](../../../reviews/plugin-architecture/other-areas.md#doc-01) | P2 | Recommended / see scope | Current architecture/contracts contradict source | Required. |
| [DOC-02](../../../reviews/plugin-architecture/other-areas.md#doc-02) | P2 | Recommended / see scope | Historical ADR language is presented as current implementation status | Required. |
| [DOC-05](../../../reviews/plugin-architecture/other-areas.md#doc-05) | P2 | Recommended / see scope | Glossaries omit supported null/no-target cases and precise heading rule | Required. |
