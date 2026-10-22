# ADR-0032: Me is global, with a local Me per Data Root

**Status:** Accepted. Built. Amends ADR-0023 ("Me stays in core": where Me is kept) and ADR-0031 (§2 `me` is now read and written).

ADR-0023 kept Me in core, as a handle in each Data Root's Local State. A person who works in several Data Roots had to run `rowbly whoami` in each one, and a Data Root without it recorded no creator or author. ADR-0031 gave per-user settings a home, `~/.rowblyrc.json`, with a `me` key that nothing used yet.

**§1 Two levels.** Me is kept at two levels:

- **Global Me**: the Home Config's `me`, the handle you work as in every Data Root.
- **Local Me**: Local State's `me` in one Data Root, as before. It replaces global Me in that Data Root, for someone who works under another handle there.

Me is the local Me, else global Me, else no one. Story `createdBy`, Comment authors, the Assignees Plugin's `me` and every other reader of Me (`PluginReadContext.me`) get this one value; none of them needs to know the levels. Existing local Mes are kept and still win; Rowbly never copies one into the Home Config or removes one on its own.

**§2 Resolution and changes.** Opening a Data Root reads both levels. A Home Config that cannot be read fails the command with `DATA_INTEGRITY` (ADR-0031 §4) instead of resolving Me without it, because that would silently record another creator or author; a missing file has no global Me. `context.setMe` changes the local Me, as before, and keeps its input and result; it rereads global Me first, so clearing the local Me falls back to the latest global Me at once. A save that does not change the local Me (`use`, Plugin Local State) leaves Me as it is. Global Me is not part of a Data Root, so changing it is not an operation: it is an `updateHomeConfig` (ADR-0031 §3), and the running context takes the saved value.

**§3 Commands and TUI.** `rowbly whoami <handle>` and `whoami --clear` change global Me and need no Data Root; `--local` changes the local Me of the Data Root in context instead. `whoami` prints Me with where it comes from; `--json` prints `{ "me", "source", "global", "local" }`, where `me` is Me as before, `source` is `local`, `global` or `null`, and `local` is `null` without a Data Root. The TUI's **Me** settings list both levels, Global (`~/.rowblyrc.json`) and This Data Root (`local.json`), each edited on its own, and the setup screen's handle sets global Me.

We rejected moving every local Me into the Home Config: a Data Root where someone works under another handle would change who they are without asking. We rejected treating an unreadable Home Config as no global Me with a warning: commands would go on recording Stories and Comments without their author. We rejected a `context.setGlobalMe` operation: operations change a Data Root under its lock and journal, and global Me is outside every Data Root.
