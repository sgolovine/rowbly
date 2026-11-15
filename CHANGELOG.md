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
- Added: The factory does not start a worker for a blocked Story. When the worker limit applies, the factory starts the upstream Stories first. (ROW-62)
- Added: The message of a factory worker lists the upstream Stories of its Story, with the ID, the title, the Stage and each `url` field, for example `pull_request`. A rule tells the worker not to do the work of the upstream Stories again. (ROW-64)
- Added: The factory supervisor sees the dependencies of each Story, and the factory shows an attention entry when an upstream Story of a blocked Story cannot progress, for example in Backlog, parked or in a hold Stage. (ROW-63)
- Added: The TUI shows and changes the `Depends on` list of a Story in the new Story form and in the General tab, and the General tab shows the `Depends on` and `Blocks` lists. A blocked Story row on the board shows `⊘`, and a blocked Story in a work Stage shows `waiting for <IDs>`. (ROW-65)
- Added: The new factory setting `dependencies.pullUpstream` moves a stuck upstream Story from Backlog to the first work Stage, so that its blocked downstream Stories can continue. The setting is off by default, and `rowbly factory configure --pull-upstream on|off` and the "Pull upstream Stories" card on the Settings › AI › Limits tab change it. (ROW-66)
- Changed: `pnpm lint` accepts the TanStack Router file names in `website/src/routes/`, for example `__root.tsx`, `$story-key.tsx` and `(legal)/`. The Biome config file is now `biome.jsonc`. (ROW-58)
- Added: The new `website/` folder has the base of the rowbly.com website, made with TanStack Start, Tailwind CSS and shadcn/ui. The new `pnpm website:dev` and `pnpm website:build` scripts run and build it. (ROW-45)
- Added: The rowbly.com website has a header, a footer, a favicon and a web manifest on each page, and placeholder pages for `/how-it-works` and `/install`. It also has shared components for the terminal frame, the install command with a copy button, the keycap, the page section and the agent tag. (ROW-47)
