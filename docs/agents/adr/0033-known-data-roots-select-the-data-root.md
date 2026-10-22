# ADR-0033: Known Data Roots in the Home Config, and `--data-root`, select the Data Root

**Status:** Accepted. Amends [ADR-0002](0002-data-root-discovery.md) and builds the `dataRoots` list of [ADR-0031](0031-per-user-settings-live-in-a-home-config.md) §2. Setup chooses where to create a Data Root and sets its label and the default, and doctor reports several defaults as `MULTIPLE_DEFAULT_DATA_ROOTS`; the TUI switcher is planned and will use the helpers below.

ADR-0002 found the Data Root like `.git`, and let `--root` or the `ROWBLY_ROOT` environment variable name one directly. A person who keeps a Data Root outside every project folder had to repeat the flag or keep the variable set, and an exported variable silently decided where every later command in that shell wrote. The Home Config now lists the Data Roots a person uses, so Rowbly can remember them and one of them can be the default.

**§1 Resolution.** Each run opens the first of:

1. `--data-root <path>`, the `.rowbly` folder itself, resolved against the current directory.
2. The one known Data Root marked `"default": true` in `~/.rowblyrc.json`.
3. The nearest `.rowbly/`, walking up from the current directory.
4. `~/.rowbly`.

When none applies the run fails with `NO_DATA_ROOT` (exit 5), and the hint names `rowbly init` and `--data-root`; the TUI opens its first-run setup instead. A Data Root that was named, by the flag or as the default, and does not exist fails with `NO_DATA_ROOT` and `details.path`; it never falls back to discovery, and the TUI does not open setup over it. A named path Rowbly may not look at fails with `USAGE`. More than one `dataRoots` entry marked default, even two that name one folder, fails with `USAGE` listing them, unless `--data-root` is given, so `rowbly doctor --data-root <path>` still runs. A Home Config that cannot be read fails as ADR-0031 §4 says; `--data-root` does not avoid that, since global Me is read from it too (ADR-0032).

`--data-root` is the only way to name a Data Root. `--root` is gone (Commander rejects it as an unknown option) and `ROWBLY_ROOT` is no longer read: a run that sets it fails with `USAGE` telling the user to unset it, rather than writing to whichever Data Root discovery finds.

The Plugins loaded before the program is built come from the same resolution, with the same inputs, as the command's own context, so a command's Plugins are those of the Data Root it opens. When that resolution fails for any reason other than finding no Data Root, no Plugin loads, and a Plugin's command or option that is unknown because of it reports the resolution error (for example the several defaults), not an unknown command.

**§2 Known Data Roots.** Every Data Root a run opens (the CLI's commands and the TUI), and every Data Root `init` or the TUI setup creates, is recorded in the Home Config's `dataRoots`, unless the folder has no `rowbly.config.json`, so that a mistyped `--data-root` is not remembered. Recording never sets or clears a label or the default. Paths are compared canonically: `~/` is expanded, a relative path is resolved against the home folder, and an existing folder is compared by its real path, so a symlink and its target are one Data Root. A folder already known, under any alias, is left exactly as stored, so opening a Data Root never repairs the file (several defaults stay for the user and doctor to settle). A new folder is appended with its canonical path. Only an explicit label or default change merges the entries that name one folder into the first, keeping its stored path, the first label, `default` if any entry had it and every key Rowbly does not know. When nothing would change Rowbly writes nothing and takes no lock, so a read-only home folder only matters when there is something new to record; then the run warns and goes on, since it does not need the record.

Storage offers `canonicalDataRootPath`, `listKnownDataRoots` (the merged list, without writing) and `registerDataRoot(home, path, { label?, default? })`, where `default: true` makes that Data Root the only default and `default: false` clears it. These are the helpers setup and the switcher build on.

We rejected keeping `--root` or `ROWBLY_ROOT` as aliases: two names for one choice, and an environment variable that outlives the command it was meant for. We rejected ignoring `ROWBLY_ROOT` silently, which would send an old script's changes to another Data Root. We rejected letting the default fall back to discovery when its folder is gone, which would hide a moved Data Root behind another one. We rejected rewriting stored paths to their canonical form when a Data Root is opened: the file is the user's, and an unchanged entry is left as they wrote it.
