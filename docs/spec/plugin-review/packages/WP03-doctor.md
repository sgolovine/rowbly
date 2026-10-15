# WP03 — Identity-safe doctor

**Depends on:** WP02C · **Wave:** 4 · **Priority:** P0 (identity repair), P1 (diagnostics)
**Review sources:** [README WP03](../../../reviews/plugin-architecture/README.md#wp03); [RES-09](../../../reviews/plugin-architecture/resiliency.md#res-09), [RES-17](../../../reviews/plugin-architecture/resiliency.md#res-17), and the doctor parts of [RES-04](../../../reviews/plugin-architecture/resiliency.md#res-04), [RES-07](../../../reviews/plugin-architecture/resiliency.md#res-07), and [RES-12](../../../reviews/plugin-architecture/resiliency.md#res-12); [ARCH-09](../../../reviews/plugin-architecture/general-architecture.md#arch-09), [ARCH-21](../../../reviews/plugin-architecture/general-architecture.md#arch-21); [CQ-70](../../../reviews/plugin-architecture/code-quality.md#cq-70); [VER-03](../../../reviews/plugin-architecture/other-areas.md#ver-03).

## Goal

Make doctor repair the intended physical record and report every integrity problem the new storage model can leave behind. To do that:

- run structural core repairs first, as their own guarded operation;
- rescan before generating plugin fixes;
- carry an exact plugin ID on internal findings;
- report interrupted transactions, orphan folders, corrupt or future-version plugin files, and legacy data.

## Owns

- `src/services/doctor.ts`, and `src/commands/doctor.ts` if the output changes
- `src/tui/screens/doctor/**`: only if finding presentation needs it
- `test/plugins/doctor.test.ts`, `test/services/doctor*.test.ts`, new `test/plugins/doctorIdentity.test.ts`, and the doctor part of `test/plugins/orphanFolders.test.ts`

## Deliverables

1. **Ordering (RES-09).**
   - Run structural key and path conflict repairs (duplicate keys, renumbering) as a guarded doctor operation through `withMutation`, which WP02C provides.
   - Then **rescan**, and only after that generate and apply plugin fix closures.
   - Keep the stable source identity and path for findings on ambiguous duplicates. Never resolve a fix by current key alone. Defer or separate findings attached to records that are about to change identity.
   - A thrown fix still aborts its current, unsaved pass (ADR-0012). Never continue with a partially changed plan.
   - Passes that already committed before a later pass failed are reported accurately.
2. **Doctor inside coordination (RES-02, doctor part).** Analysis that produces a fix plan runs under the lock, or is revalidated and rebuilt after the lock is acquired. A doctor snapshot racing a Story update can't apply a stale plan.
3. **Attribution (ARCH-09, RES-17, CQ-70, CQ-71).**
   - Internal findings carry a private `pluginId`. Fix failures and disable hints use that exact ID. Never parse an ID back out of a code.
   - Strip the private metadata (and `apply`) from the JSON report.
   - Emit `details: { ...finding.details, plugin: id }` for plugin findings; framework attribution wins.
   - Validate local codes as uppercase underscore tokens, and reject collisions with core codes clearly.
   - Route checks and fixes through WP01B's adapter.
4. **DoctorData.local (ARCH-21).** Pass Local State to custom checks; the type comes from WP04A. Malformed `local.json` follows the existing core policy. Disabled local data stays unchecked and preserved.
5. **New diagnostics:**
   - interrupted or leftover transactions and journal artifacts, using the codes and recovery guidance defined in ADR-0019;
   - abandoned `.moving` staging (RES-04): an integrity finding, not `UNKNOWN_FILE`;
   - orphan Story and Board folders that hold plugin files (RES-07), with the ownerless path and an explicit recovery or removal decision. Never auto-adopt;
   - corrupt and future-version plugin files, reported through plugin checks. WP08A owns the Epic parsing; doctor never rewrites these files automatically;
   - "unchecked inactive data" kept distinct from "validated healthy data".
6. **Legacy data (VER-03, U1).** By default, add a targeted raw-JSON check that detects top-level legacy Comments (and old Epic files or links) **before** schema stripping, and report backup and upgrade guidance. If the user chose an importer at Checkpoint A, implement it here as an explicit, dry-run-capable operation through the coordinator that preserves IDs, authors, and timestamps. Never import automatically on startup.
7. **Bounded convergence.** A `--fix` run converges, or it reports a bounded unresolved state. It never loops silently.
8. **DX-29 (optional).** Export a root-relative `storyPath`/`boardPath` formatter only if the storage layout is an intentional public contract. Otherwise accept an explicit finding target. Defer it if neither is clearly needed.

## Acceptance criteria

- [ ] The duplicate WEB-1 fixture from `r06` keeps the keeper's valid Epic link, and only the renumbered duplicate gets its own repair. Diagnostic paths name the actual owner files (WEB-7, not WEB-1). Two different duplicate groups plus missing links are fixed together correctly (RES-09).
- [ ] Guards veto a repair before any disk change. A failure in one pass is recoverable as a transaction. The report says which passes committed.
- [ ] Failed fixes from `two-words` and `a-b-c` keep the complete ID in their details and in the disable hint. Core findings are unaffected. A custom finding's details are preserved. A colliding code fails clearly (RES-17, ARCH-09).
- [ ] A fixture custom check reads and fixes a local preference (ARCH-21).
- [ ] Interrupted transactions, `.moving` leftovers, plugin-bearing orphan folders, corrupt Epic files, and future-version files are each reported with their path. No automatic destructive rewrite happens.
- [ ] Legacy top-level Comments are detected before any write strips them, according to the U1 decision (VER-03).
- [ ] The doctor JSON output shape is unchanged except for the documented additions.

## Findings

8 rows. Record final statuses in [findings.md](../findings.md#wp03).

| Finding | Priority | Disposition | Issue | Required outcome |
| --- | --- | --- | --- | --- |
| [ARCH-09](../../../reviews/plugin-architecture/general-architecture.md#arch-09) | P1 | Recommended / see scope | Doctor reconstructs a plugin ID lossily from its code | Required. |
| [ARCH-21](../../../reviews/plugin-architecture/general-architecture.md#arch-21) | P2 | Recommended / see scope | Custom doctor checks cannot inspect Local State through DoctorData | Required. |
| [CQ-70](../../../reviews/plugin-architecture/code-quality.md#cq-70) | P1 | Recommended | Plugin attribution cannot be reconstructed from a finding code. | Required. |
| [CQ-71](../../../reviews/plugin-architecture/code-quality.md#cq-71) | See linked finding | Merged |  | None separately — resolved by CQ-35, CQ-01, CQ-70. |
| [DX-29](../../../reviews/plugin-architecture/straightforwardness-for-plugin-authors.md#dx-29) | Optional | Optional / bounded | Doctor checks spell storage paths and need contextual literal types | Evaluate; implement only if the entry's condition holds, else `deferred: <reason>`. |
| [RES-09](../../../reviews/plugin-architecture/resiliency.md#res-09) | P0 | Recommended / see scope | Doctor's pre-renumber plugin fix edits the keeper instead of the duplicate | Required. |
| [RES-17](../../../reviews/plugin-architecture/resiliency.md#res-17) | P1 | Recommended / see scope | Doctor reconstructs the wrong ID for multiword plugins | Required. |
| [VER-03](../../../reviews/plugin-architecture/other-areas.md#ver-03) | P3 / conditional | Conditional / decision | Historical top-level Comments are silently discarded on a later write | Implement per the package / §9 decision; if the condition does not apply, `deferred: <condition>`. |
