# ADR-0036: Binary Plugin files use the existing commit journal

**Status:** Accepted (ROW-26). Amends ADR-0001 (Plugin payload formats) and ADR-0019 §4 (file change values).

## Context

A Plugin may need PNG files beside a Story's JSON bag. Saving the bag and file separately can leave
missing or unreferenced files after a crash. Text decoding cannot preserve arbitrary bytes. The
existing transaction engine already stages raw bytes for recoverable Git publication.

## Decision

### 1. One commit path

Add `changes.writeBinaryFile(scope, name, Uint8Array)`, `changes.readBinaryFile(scope, name)` and
`plugin.files.readBinary(scope, name)`. Preserve the text API. Binary writes use the same Data Root
lock, scoped path and symbolic link policy, stage leases, final checks, staging and recovery as text.
`deleteFile` removes either kind. Story renumbering carries raw files with the Story folder.
The version 1 journal needs no change: manifests contain paths, and staged payload files hold bytes.
Never parse or serialize binary payloads as JSON. Doctor treats scoped Plugin files as Plugin-owned;
Git Automatic Commits and synchronization retain their raw bytes.

### 2. Ownership and views

Copy write input synchronously before awaiting any scope or filesystem access. Keep pending bytes
private, and return a detached `Uint8Array` from each binary read. This prevents caller mutation from
changing an accepted write, another hook's read or the save.

Keep `FileChange.type` as `file`. Text writes retain string values. For binary writes, present
`before` and `after` versions are `{ kind: 'binary', size, sha256 }`; absence or deletion is `null`.
Size counts bytes, SHA-256 is lowercase hexadecimal. These small objects fit deeply frozen snapshots
without typed-array freezing or exposing payloads. They are not persisted type metadata. On deletion
or a text replacement, describe stored valid UTF-8 as text and other bytes as a summary; check UTF-8
validity before decoding. Explicit text reads retain UTF-8 decoding behavior.

### 3. Evidence

Extend the existing transaction fault/crash plan with byte-exact create, replace, delete and move
cases. Compare raw bytes, inject faults at every filesystem boundary, and repeat recovery. Exercise
Plugin buffer ownership, pending/stored reads and sealed writers in the Plugin pipeline tests, and
raw byte inclusion in the existing Git automatic commit and synchronization scenarios.

## Rejected alternatives

- Direct filesystem writes bypass the lock and journal and cannot save the bag and payload together.
- Base64 in JSON increases payload size and duplicates an existing raw staging mechanism.
- Buffers in public Change Set snapshots expose mutable payloads and cannot be deeply frozen.
- A separate binary journal or persisted type registry adds a migration without improving recovery.
