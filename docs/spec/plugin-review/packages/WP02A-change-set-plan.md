# WP02A — Change Set plan: logical scopes, private identities, full-plan validation

**Depends on:** WP01A, WP02B · **Wave:** 3 · **Priority:** P0 · **Critical path:** yes
**Review sources:** [README WP02](../../../reviews/plugin-architecture/README.md#wp02); [ARCH-38](../../../reviews/plugin-architecture/general-architecture.md#arch-38), [ARCH-41](../../../reviews/plugin-architecture/general-architecture.md#arch-41); [RES-01](../../../reviews/plugin-architecture/resiliency.md#res-01), [RES-06](../../../reviews/plugin-architecture/resiliency.md#res-06) (identity half), [RES-08](../../../reviews/plugin-architecture/resiliency.md#res-08), [RES-10](../../../reviews/plugin-architecture/resiliency.md#res-10), [RES-24](../../../reviews/plugin-architecture/resiliency.md#res-24); [PERF-03](../../../reviews/plugin-architecture/other-areas.md#perf-03), [PERF-04](../../../reviews/plugin-architecture/other-areas.md#perf-04); [CQ-40–45](../../../reviews/plugin-architecture/code-quality.md#cq-40).

## Goal

Make the Change Set produce a validated final plan, and commit that plan through WP02B's transaction engine:

- keep source identities private;
- store pending file changes as logical scopes;
- resolve scopes three ways (absent, present, deleted);
- validate the **entire** final plan before any live write;
- replace sequential saves with one recoverable transaction;
- index lookups without losing ordered snapshots.

## Owns

- `src/services/plugins/changeSet.ts`
- `src/storage/repositories.ts`: only as needed to read records through the plan and engine. Prefix-cache and allocation work belongs to WP02C.
- `src/storage/files.ts`, `src/storage/jsonStore.ts`: integration call sites only
- `test/plugins/pipeline.test.ts`: the renumber and owner-file sections
- new tests: `test/plugins/deletedScopes.test.ts`, `test/plugins/fileScopeChanges.test.ts`, `test/plugins/transactionFailure.test.ts` (the in-process injection part), and the integration part of `test/plugins/moveRecovery.test.ts`

## Deliverables

1. **Private identity (D3 storage half, RES-06).** The plan records each change's original storage identity (its source path) privately. The deletion target and move source come from that private identity. A snapshot's `before` can never supply them.
2. **Logical file scopes (D5, ARCH-38, RES-08, RES-10, RES-24).**
   - A pending file change stores `{ pluginId, relativeName, ownerIdentity }`. The physical path is resolved at commit preparation, from the final owner state.
   - Scope lookup uses three states for Boards and Stories:
     - Writes to a deleted scope are rejected before save, whether they were queued before or after the deletion.
     - Reads of a deleted scope return absent.
     - A Board created in the same plan can own files (RES-24).
     - A Story renumbered after its file was queued takes the file with it (RES-10).
   - Never mkdir a deleted parent.
   - Mixed-case Story keys still resolve.
   - Cascaded whole-folder deletion still removes the files of all plugins, including disabled ones.
3. **Full-plan validation (ARCH-41, RES-01 part).** Before staging, validate:
   - every record against its schema;
   - parent lifecycle (no write beneath a deleted owner; a child must not outlive its deleted parent);
   - source and destination identities;
   - path containment and the symlink policy, using WP02B's `pathPolicy`;
   - duplicate target moves;
   - occupied destinations.

   An invalid plan writes **nothing**.
4. **Commit through the engine (ARCH-41, RES-01, RES-04 integration).**
   - `save()` builds one engine transaction covering record writes, plugin file writes and removals, Story folder moves, and Story or Board folder deletions, then commits it.
   - Replace the "moves, then sequential saves" flow.
   - Report save-stage errors with the affected paths. Never report "nothing saved" after a failed commit unless recovery confirmed that.
   - Reactions never run after a failed save.
5. **Indexes (PERF-03, PERF-04).**
   - Index current Story keys, the historical aliases used by `story(key)`, Board IDs, and file paths. Keep the ordered array for save order and reaction order.
   - Maintain the indexes through one insertion and update path, including `recordStory` and `deleteBoard`.
   - The first `updateStory` or `updateBoard` reads its stored record once. Pending updates do no stored read.
   - Do not add a public bypass API.
6. **Cleanups:**
   - CQ-40: separate resolution from assembly.
   - CQ-42: `storyAtCurrentKey`, with a comment on renumber semantics.
   - CQ-45: "Core only" comments.
   - Optional: CQ-41 (return `{ path, recordFolder }`), CQ-43, CQ-44. Apply these only if touching the code.

## Acceptance criteria

- [ ] A write to a Story or Board, before or after its deletion, can't recreate the owner folder. No operation reports success with a contradictory final state. Parent deletion still removes the stored files of disabled plugins (RES-08, ARCH-38).
- [ ] Creating a Board and writing a file for it commit in one guarded operation. A guard rejection writes neither (RES-24).
- [ ] The `move-file.ts` reproduction saves the file under WEB-2 with no orphan WEB-1 folder. Existing renumbering preserves the plugin files already on disk (RES-10).
- [ ] An invalid final record anywhere in the plan causes **zero** live writes (`r03-partial-save` case A).
- [ ] Failure injection at each write, move, or delete during assignee removal, and during Epic and Spec deletion, yields the complete old state or the complete new state after in-process recovery (`r03` cases A and B). WP02C adds the subprocess-kill variant.
- [ ] An occupied move target fails before any source moves. Renumbering a Story whose target folder holds a stray Spec (`r04`) leaves all Stories accessible.
- [ ] Repeated updates coalesce as before. Case-insensitive lookup, old and new renumber keys, deletion, `recordStory`, and Board deletion keep correct before/after data and order. Indexed lookups do no full-list scan (PERF-03, PERF-04).

## Findings

12 rows. Record final statuses in [findings.md](../findings.md#wp02a).

| Finding | Priority | Disposition | Issue | Required outcome |
| --- | --- | --- | --- | --- |
| [ARCH-38](../../../reviews/plugin-architecture/general-architecture.md#arch-38) | P0 | Recommended / see scope | Plugin file scopes ignore pending Board creation and fall back through pending deletions | Required. |
| [CQ-40](../../../reviews/plugin-architecture/code-quality.md#cq-40) | P2 | Useful | src/services/plugins/changeSet.ts:243: return \${await scopeFolder(...)}plugins/${id}/${checkName(name)}\ mixes resolution and assembly. Use const recordFolder = await scopeFold… | Required. |
| [CQ-41](../../../reviews/plugin-architecture/code-quality.md#cq-41) | Optional | Optional | src/services/plugins/changeSet.ts:238: prune boundary reconstructed via path.slice(0, path.indexOf(...)). This depends on generated path structure; no reachable bad boundary was… | Evaluate; implement only if the entry's condition holds, else `deferred: <reason>`. |
| [CQ-42](../../../reviews/plugin-architecture/code-quality.md#cq-42) | P2 | Useful | src/services/plugins/changeSet.ts:56 versus src/services/plugins/changeSet.ts:210: public story() matches before/after keys, private current() matches latest key (or before when… | Required. |
| [CQ-43](../../../reviews/plugin-architecture/code-quality.md#cq-43) | Optional | Optional | src/services/plugins/changeSet.ts:76/:103: null latest here means deletion earlier in this Change Set; repository misses throw before this line. Add that comment if editing thes… | Evaluate; implement only if the entry's condition holds, else `deferred: <reason>`. |
| [CQ-44](../../../reviews/plugin-architecture/code-quality.md#cq-44) | Optional | Optional | src/services/plugins/changeSet.ts:43 uses list; src/services/plugins/changeSet.ts:166 uses p for paths. Rename to pendingChanges and dirs if touching the file broadly. | Evaluate; implement only if the entry's condition holds, else `deferred: <reason>`. |
| [CQ-45](../../../reviews/plugin-architecture/code-quality.md#cq-45) | P2 | Useful | src/services/plugins/changeSet.ts:86/:107: recordStory/deleteBoard are core-only methods absent from the Plugin interface. Add “Core only” to these comments. | Required. |
| [PERF-03](../../../reviews/plugin-architecture/other-areas.md#perf-03) | P2 | Recommended / see scope | Pending Change Set searches have quadratic aggregate cost | Required. |
| [PERF-04](../../../reviews/plugin-architecture/other-areas.md#perf-04) | P2 | Recommended / see scope | First updateStory rereads its before-record | Required. |
| [RES-08](../../../reviews/plugin-architecture/resiliency.md#res-08) | P0 | Recommended / see scope | A file write can recreate the folder of a deleted owner | Required. |
| [RES-10](../../../reviews/plugin-architecture/resiliency.md#res-10) | P0 | Recommended / see scope | Already-queued plugin file paths remain under an old Story key | Required. |
| [RES-24](../../../reviews/plugin-architecture/resiliency.md#res-24) | P0 | Recommended / see scope | A Board created in the pending Change Set cannot own a plugin file yet | Required. |
