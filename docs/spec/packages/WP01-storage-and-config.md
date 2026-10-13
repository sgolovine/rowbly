# WP01 — Storage & Configuration Layer

**Depends on:** WP00 · **Phase:** 1 (parallel with WP02)

## Goal

Implement contracts §1, §3, §4 (the Data Root and Local State parts) and §9: the only code that touches the filesystem.

## Owns

`src/storage/**`, `src/services/context.ts` (resolveWorkspace/resolveBoard/use/clearUse/setMe), `src/services/config.ts`, and their tests.

## Deliverables

1. `findDataRoot` with the precedence order from contracts §4. Walk up from cwd until the filesystem root. Use `~/.rowbly` only if it exists. Return `{ path, kind }`.
2. `paths(root)` for every path in contracts §1.
3. `readJson` and `writeJson`:
   - Writes are atomic: write a temp file in the same directory, then rename it.
   - Keys are written in schema order, with 2-space indentation and a trailing newline.
   - `ENOENT` becomes `NotFoundError`.
   - Malformed JSON or a schema failure becomes `DataIntegrityError` with `details.path` and the zod issues.
   - A file containing git conflict markers (`<<<<<<<`) becomes `DataIntegrityError` with `details.conflict = true`.
4. Repositories for root config, Local State (a missing `local.json` counts as `{version:1}`), workspaces, boards, stories and epics. Each repository has list/get/put/delete operations and checks that the id matches the path.
   - `stories.allInBoard(ref)` reads all story files in parallel.
   - `stories.findByKey(key)` uses a prefix index built from the board configs and cached for the lifetime of the context.
   - `stories.maxNumber(ref)` scans the board's stories.
   - `boards.findByPrefix(prefix)`.
5. `resolveCascade` and `services.config.effective`, which return the effective lists along with their source levels.
6. `services.context`: workspace and board resolution (contracts §4), `use`, `clearUse` and `setMe`. These validate that the referenced workspace, board or handle exists. `use` without a board clears the stored board.

## Acceptance criteria

- [ ] Discovery tests cover: `--root` wins; the env var wins over walking up; a nested cwd finds an ancestor `.rowbly`; the global fallback is used only when it exists; with none of these, the result is `DataRootNotFoundError`.
- [ ] Atomic write: if writing fails mid-way (simulated by a mock rename throwing), the old file stays intact and no temp files are left behind.
- [ ] Written files are byte-for-byte stable: writing the same parsed value twice gives identical bytes.
- [ ] Cascade tests cover each of the four source levels for stages and for custom fields independently, for example board stages combined with global fields.
- [ ] Story lookup by key resolves across workspaces. An unknown prefix gives `NotFoundError`.
- [ ] A file containing conflict markers is reported as `DataIntegrityError` with `conflict: true`.
- [ ] Context resolution: with a single workspace, no flags are needed. With two workspaces and no context, the result is `UsageError`. A `local.json` board from another workspace is ignored.
