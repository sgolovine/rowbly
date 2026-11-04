# ADR-0058: Git synchronization compares index content and names why it failed

**Status:** Accepted (ROW-89). Amends [ADR-0034](0034-git-synchronization-publishes-recoverably.md)
§5 for the index fingerprint and the index lock after installation, and
[ADR-0020](0020-plugin-execution-and-data-contracts.md) §5 for the hint on an unexpected error
from a Plugin's own command.

ADR-0034 §5 revalidates an "index fingerprint" before publication without defining it. The code
compared the raw bytes of `.git/index`. `git status`, `git diff`, editors, the T3 UI and shell
prompts rewrite the index's stat cache without changing what is staged, so `rowbly git sync`
failed with "Git index changed before publication" whenever one of them ran beside it. Once the
candidate index was installed and its reservation released, the same refresh, or such a command
holding its own `index.lock`, made the rest of publication and its recovery refuse the
publication, which then needed recovery before the next read. A Data Root that another writer,
such as the TUI, kept saving failed after three immediate attempts, and every failure was a
`CONFLICT` whose only hint was "Resolve the reported cause", so agents could not tell a retryable
failure from one that needs a person.

## 1. The index fingerprint is staged content

The index fingerprint is the staged content of the index: for every entry, its path, mode, object
and stage (`git ls-files --stage`). Two index images with the same entries are the same
fingerprint, whatever their caches hold. Equal bytes are compared first, so the usual case runs no
Git command.

- Before the Data Root locks, and again once the real `index.lock` is reserved, the live index
  must stage what the prepared plan expected. A real staged change fails with `index-changed`
  and names the staged paths. Sync prepares again, as for a capture change (§3).
- The journal records the bytes read under the reservation as `indexBefore`. No cooperating Git
  writes the index while Rowbly holds its lock, so recovery may compare those bytes exactly.
- After the candidate index is installed the reservation is released. Recovery and the rest of
  publication then compare the live index with the journal's images by content.
- After installation another Git command may hold `index.lock`. Git checks that the index it read
  is still current before it writes, so that holder cannot revert the installed index. Rowbly
  neither waits for nor removes it. Before installation a lock that is not Rowbly's own is still
  refused, as ADR-0034 §5 says. When Rowbly reserves the index and another Git command holds its
  lock, Rowbly waits up to 2 seconds for it.

## 2. A failed Sync names its reason

A failed synchronization result, and the error `rowbly git sync` exits with, carry a stable
`reason`, whether retrying can help (`retryable`) and the paths concerned (`paths`, when known):

| `reason` | Meaning | `retryable` |
| --- | --- | --- |
| `capture-changed` | Another writer, such as the TUI, kept saving Rowbly data | yes |
| `index-changed` | Another Git command changed what is staged during Sync | yes |
| `network` | Fetch or push failed; a local result is kept | yes |
| `resolution-off` | Automatic Merge Conflict Resolution is Off in this checkout | no |
| `no-upstream` | No checked-out branch, or it has no configured Git upstream | no |
| `conflict` | A Git state or conflict that needs a person | no |
| `evidence` | Merge Evidence disagrees at the same path | no |
| `unexpected` | Anything else | no |

`rowbly git sync` with Automatic Merge Conflict Resolution Off is a `USAGE` error (exit 2) with
the hint ``rowbly git configure --automatic-merge-resolution on``. Other failures stay `CONFLICT`
(exit 4) with a hint for their reason. A `capture-changed` failure names the Stories whose files
changed by Story Key.

## 3. Sync waits for the Data Root to go quiet

When the capture or the index changed while Sync prepared it, Sync waits until reads of the Data
Root have not changed for 2 seconds, at most 15 seconds, before it prepares again. It still makes
three attempts within its run deadline. A person may keep saving in the TUI: Sync succeeds once
they pause, or fails with `capture-changed`.

## 4. A Plugin's own command does not suggest turning it off

ADR-0020 §5 gives an unexpected throw the hint ``turn it off with `rowbly plugins disable <id>` ``.
That advice helps when a Plugin's hook breaks other work. When the error comes from the Plugin's
own command, which a person or an agent ran on purpose, turning the Plugin off does not fix
anything. The command's error is still `INTERNAL`, attributed with `details.plugin` and
`details.stage`, but has no such hint.

## 5. Rejected alternatives

- Keeping byte comparison and retrying more often would still fail beside a shell prompt that
  runs `git status` before every line.
- Taking `index.lock` for the whole Sync would stop people's own Git commands for up to two
  minutes.
- Matching failures by message text would break whenever a message changes. The reason is a
  separate field.
