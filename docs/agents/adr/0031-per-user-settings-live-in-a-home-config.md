# ADR-0031: Per-user settings live in a Home Config, `~/.rowblyrc.json`

**Status:** Accepted. Implements the maintainer's request for a per-user configuration file. The file, its schema and its safe writes are built; global Me and the list of known Data Roots are read and written by nothing yet, and will amend ADR-0002 and Local State's Me when they are.

Every setting Rowbly keeps today belongs to one Data Root: its configuration in `rowbly.config.json` and the developer's Local State in `local.json`. Settings that belong to the person rather than to a Data Root, such as the handle they work as everywhere or the Data Roots they use, have nowhere to live.

**§1 The file.** The Home Config is `~/.rowblyrc.json`, in the home folder that Node's `os.homedir()` reports. Every run of `rowbly`, including `--version`, `--help` and the TUI, creates it as `{ "version": 1 }` when nothing is at that path. Creating it is best effort: when the home folder cannot be written, the command runs without it, silently. A later read or change of the Home Config that the filesystem refuses fails with `USAGE` (exit 2) naming the file and the folder to check. Creation never replaces anything: the file is written in full beside the destination and hard-linked into place only if the name is still free.

**§2 The schema.** A JSON object (`src/schemas/homeConfig.ts`):

- `version`: `1`. A file without it is read as version 1; a file with another version is not read and not written.
- `me`: optional, a handle in the same form as Local State's `me`, meant to be Me for every Data Root.
- `dataRoots`: optional, a list of `{ "label"?: string, "path": string, "default"?: boolean }`, one per known Data Root, where `path` is the Data Root folder itself. The schema accepts several entries with `default: true`, so that the tools that read the list can report the conflict instead of losing an entry.

Keys Rowbly does not know, at the top level and in each `dataRoots` entry, are kept unchanged when Rowbly writes the file, so other tools and future versions can add their own. Rowbly writes the keys it knows first, in schema order, then the others in their stored order.

**§3 Safe writes.** Every change goes through one read-change-write under a lock beside the file, `~/.rowblyrc.json.lock`. It is the Data Root lock of ADR-0019 §1 (exclusive create, stale-lock breaking with `.lock.break`, a 10 s wait then `CONFLICT`) under another file name. Under the lock Rowbly rereads the file, applies the change and replaces the file atomically (a fsynced temporary file renamed over it), so concurrent Rowbly processes each start from the last one's result and no change is lost. A symlinked Home Config, as dotfile managers make, is updated at its target, so the link stays; the new file keeps the old one's permissions. Editors and other tools do not take the lock, as for the Data Root.

**§4 Unreadable files.** A Home Config that is not valid JSON, does not match the schema, has conflict markers, is not a file, or is a link to a missing file is never replaced. Reading or changing it fails with `DATA_INTEGRITY` naming the file; the user fixes or moves it. Creation at start-up leaves it alone, so commands that do not need it keep working.

We rejected storing per-user settings in `~/.rowbly/` (the global Data Root): it is optional, it is a Data Root with its own Boards, and a person who uses only project Data Roots has none. We rejected writing the file without a lock and with the last writer winning: two Rowbly processes registering different Data Roots at once would lose one. We rejected rejecting unknown keys, which would make every older Rowbly refuse a file a newer one wrote.
