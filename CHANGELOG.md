# Changelog

This file records the changes to Rowbly that users can see.

- `### Pre Release` holds the changes for the next release. The `Changelog` Stage of the factory
  adds one entry for each Story.
- The release workflow changes `### Pre Release` to the version, for example `### 1.12.0`. Then it
  adds a new empty `### Pre Release` section above it.

### Pre Release

- Added: Story files can have a `dependsOn` list of upstream Stories. `rowbly story delete` removes the deleted Story from each `dependsOn` list and shows a warning for each changed Story. (ROW-59)
- Added: `rowbly doctor` finds bad `dependsOn` lists in Story files, for example unknown IDs, self dependencies, duplicates and cycles. `rowbly doctor --fix` repairs the safe problems. (ROW-61)
- Added: `rowbly story create` and `rowbly story update` have the `--depends-on` flag, and `rowbly story update` has `--add-dependency` and `--remove-dependency`. `rowbly story get` shows `Depends on`, `Blocks` and `Blocked`, and `rowbly story search` has the `--blocked` and `--ready` filters. (ROW-60)
- Added: The factory starts its daemon again automatically after a crash, with a longer wait after each crash. After 5 crashes in a row, the factory stops with the `failed` phase, and `rowbly factory status` and the TUI factory screen show the restart count and the time of the last crash. (ROW-67)
