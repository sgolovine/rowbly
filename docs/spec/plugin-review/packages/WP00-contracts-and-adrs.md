# WP00 — Contracts & ADRs

**Depends on:** — · **Wave:** 0 · **Priority:** P0 enabler · **Gate:** none. Its merge triggers **Checkpoint A**.
**Review sources:** [Decisions to settle before parallel implementation](../../../reviews/plugin-architecture/README.md#decisions-to-settle-before-parallel-implementation); [Recommendations not adopted wholesale](../../../reviews/plugin-architecture/README.md#recommendations-not-adopted-wholesale).

## Goal

Before any parallel implementation starts, settle the shared stage, lock, identity, bag, and error contracts in durable ADRs. The review explicitly asks for this: "The storage owner should write a short ADR for decisions 1–5 before code lands. The API owner should document 6–9 and publish the agreed type signatures." This package is **documentation only**. It changes no source.

## Owns

- New `docs/adr/0019-coordinated-recoverable-commits.md`, covering D1, D2, D5, the D3 storage-identity half, and the §7 guarantee table.
- New `docs/adr/0020-plugin-execution-and-data-contracts.md`, covering D3 views, D4, D6, D7, D8, D9, the §4 phase table, and the §5–§6 bag, settings, and result contracts.
- Your rows in `findings.md`.

## Must not touch

`src/**`, `test/**`, existing ADRs, `docs/PLUGINS.md`, and `docs/ARCHITECTURE.md`. WP09A adds status notes and supersession links to ADR-0012 and ADR-0013 after this package merges.

## Deliverables

1. **ADR-0019, Coordinated, recoverable commits.** Turn [contracts.md](../contracts.md) D1, D2, D5, and §7 into concrete decisions:
   - **Lock (W2):** mechanism, file location, canonical-root rule (realpath), acquisition timeout, stale-owner detection and recovery, release on every failure, and reuse of the held context for reads inside an operation. Whether *read-only* commands take the lock or only wait for recovery. A small shared/exclusive scheme is acceptable if justified.
   - **Journal (W3):** directory layout, manifest schema (operation ID, phases, original paths, staged paths, final paths, deletions, moves), the phase markers, and the recovery policy: roll forward prepared transactions, restore unprepared ones. Idempotency. Running again after interrupted recovery. Gitignore entries. Which doctor finding codes report leftovers (consumed by WP03).
   - **Durability (W4):** exactly which crash class is covered, and the fsync policy.
   - **Participating-reader protocol:** recovery runs before repository access. Readers never see half-commits. The limits for external tools.
   - **Final-plan validation:** the complete list of checks run before any live write. That covers record schemas, parent lifecycle, source and destination identity, path containment, duplicate target moves, occupied destinations, and writes beneath deleted scopes.
   - **Logical file scopes:** the pending file-change shape (plugin ID, relative name, private owner identity), the tri-state scope lookup, and the rules for create/delete/renumber interactions.
   - **Symlink policy (W5):** RES-21 and SEC-02.
   - **Stale context:** operations re-read Local State and records under the lock, and the context is refreshed from the committed result (ARCH-37).
2. **ADR-0020, Plugin execution, data preservation, and error contracts.**
   - The §4 phase/capability table, with the runtime enforcement mechanism (`AsyncLocalStorage`) and the stage-lifetime handle rule.
   - Bag states and the `readBag` / `requireBag` contract. The dirty-form contract: unchanged or failed providers never emit input, and clearing is explicit. The `writeBag` return type and the root-settings exclusion.
   - The D7 error table, recorded as an **amendment to ADR-0012's blanket wrapping policy**. ADR-0012 is not rewritten here.
   - The result contract (§6), including W11.
   - The trust model (D8) and API restraint (D9).
   - The W6, W7, W10, and W12 choices.
3. **Type-signature appendix**, in ADR-0020 or as an appendix file next to it. Write TypeScript sketches for every signature WP04A will publish. The list is in [WP04A § Signatures to publish](WP04A-api-safety-contracts.md#signatures-to-publish). For each one, give its name and shape, and say which stage it belongs to. These are sketches. WP04A may refine names but must keep the semantics.
4. **Decision record for W1–W12.** Accept each default in [contracts.md §9](../contracts.md#9-open-decisions) or justify a different choice. Close CQ-04, CQ-05, and CQ-06 according to W1. Under the default, set each to `deferred: keep current verbs/layout/result shapes per ADR-0020 (W1)`.
5. **User questions U1–U4.** Restate them in the PR body, each with its recommended default, so the supervisor can paste them at Checkpoint A.

## Acceptance criteria

- [ ] Both ADRs exist and follow the format and status conventions of the existing ADRs.
- [ ] Every decision D1–D9 is covered concretely enough that WP02B and WP04A can start without asking. In particular, nothing in D1/D2 is left as "TBD".
- [ ] ADR-0020 states explicitly that it amends ADR-0012's error policy. It also states which existing tests encode the old policy: `test/plugins/pipeline.test.ts` (around `:47`) and `test/plugins/cli.test.ts` (around `:123`). WP01B updates those tests.
- [ ] The guarantees describe consistency after recovery for participating readers. They never claim instantaneous multi-file atomicity, sandboxing, or protection from external editors.
- [ ] The type-signature appendix covers every item in WP04A's list.
- [ ] Rows for CQ-04, CQ-05, and CQ-06 have a final status.
- [ ] `pnpm lint` passes (Markdown is included in Biome's scope where configured).

## Findings

3 rows. Record final statuses in [findings.md](../findings.md#wp00).

| Finding | Priority | Disposition | Issue | Required outcome |
| --- | --- | --- | --- | --- |
| [CQ-04](../../../reviews/plugin-architecture/code-quality.md#cq-04) | Optional | Optional | Built-in Plugin naming/layout is inconsistent. | Evaluate; implement only if the entry's condition holds, else `deferred: <reason>`. |
| [CQ-05](../../../reviews/plugin-architecture/code-quality.md#cq-05) | Optional | Optional | Internal operation and function verbs vary. | Evaluate; implement only if the entry's condition holds, else `deferred: <reason>`. |
| [CQ-06](../../../reviews/plugin-architecture/code-quality.md#cq-06) | Optional | Optional | Delete result shapes vary. | Evaluate; implement only if the entry's condition holds, else `deferred: <reason>`. |
