# Changelog

This file records the changes to Rowbly that users can see.

- `### Pre Release` holds the changes for the next release. The `Changelog` Stage of the factory
  adds one entry for each Story.
- The release workflow changes `### Pre Release` to the version, for example `### 1.12.0`. Then it
  adds a new empty `### Pre Release` section above it.

### Pre Release

- Added: Story files can have a `dependsOn` list of upstream Stories. `rowbly story delete` removes the deleted Story from each `dependsOn` list and shows a warning for each changed Story. (ROW-59)
- Added: `rowbly story create` and `rowbly story update` have the `--depends-on` flag, and `rowbly story update` has `--add-dependency` and `--remove-dependency`. `rowbly story get` shows `Depends on`, `Blocks` and `Blocked`, and `rowbly story search` has the `--blocked` and `--ready` filters. (ROW-60)
