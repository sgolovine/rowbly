# Changelog

This file records the changes to Rowbly that users can see.

- `### Pre Release` holds the changes for the next release. The `Changelog` Stage of the factory
  adds one entry for each Story.
- The release workflow changes `### Pre Release` to the version, for example `### 1.12.0`. Then it
  adds a new empty `### Pre Release` section above it.

### Pre Release

- Added: In the Factory view, a Thread that is open in the Story sidebar has an `Open Story` button with the key `o`. The button shows the Story list and opens the Story of the Thread in the Story sidebar. (ROW-70)
- Added: Each Stage in `.rowbly/rowbly.config.json` can have the optional `expandedByDefault` key. When it is `false`, the section of that Stage in the All Stages view of the TUI is collapsed when a Project opens. (ROW-72)
- Changed: Each Story file is now in the folder of its Stage, for example `.rowbly/stories/BACKLOG/ROW-1.md`, and Rowbly moves the file when the Stage of the Story changes. Rowbly still reads Story files directly in `.rowbly/stories/`, `rowbly doctor` shows a warning for a Story file that is not in the folder of its Stage, and `rowbly doctor --fix` moves it. (ROW-69)

### 0.18.0

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
- Added: The new `website.yml` workflow deploys the website to GitHub Pages at `https://rowbly.com` when `main` changes, and only builds it for a pull request. The website has a branded 404 page. (ROW-46)
- Added: The rowbly.com website has a header, a footer, a favicon and a web manifest on each page, and placeholder pages for `/how-it-works` and `/install`. It also has shared components for the terminal frame, the install command with a copy button, the keycap, the page section and the agent tag. (ROW-47)
- Added: The home page of the rowbly.com website has a Hero section and a proof strip. They show the headline, the install command, links to get started and to GitHub, and a real Rowbly board with 26 AI agents, with animations that stop when the browser asks for reduced motion. (ROW-48)
- Added: The home page of the rowbly.com website has a "Stories move themselves" section with an animated board, where Stories move from Backlog to Done and an agent works on each Story in a working Stage. The header of each working column shows its Stage prompt in a tooltip, and the animation has a Pause button and stops when the browser asks for reduced motion. (ROW-49)
- Added: The home page of the rowbly.com website has a "How it works" section with the four steps from idea to pull request, and a "Watch everything live" section that shows an agent conversation that types out and an Attention banner when the agent is blocked. The animation stops when the section is off screen or when the browser asks for reduced motion. (ROW-50)
- Added: The home page of the rowbly.com website has closing sections about your own models, the board as files in your repo, the terminal UI and the CLI, and Specs and attachments. A final install section shows the install commands and links to the Install page and to GitHub. (ROW-51)
- Added: The `/how-it-works` page of the rowbly.com website explains the board, the Stage prompts, the factory, the Threads and Attention items, your models and the `.rowbly/` files, and has a link to the Install page. It replaces the placeholder page. (ROW-52)
- Added: The `/install` page of the rowbly.com website shows the requirements, the commands to install Rowbly, to start it, to sign in to a provider and to start the factory, each with a copy button, and the facts about costs and keys. It replaces the placeholder page. (ROW-53)
- Added: Each page of the rowbly.com website has its own title, description, canonical URL and social card with a new OG image, and the home page has `SoftwareApplication` structured data. The website build also writes `sitemap.xml` and `robots.txt`. (ROW-54)
- Added: The new `website/public/screenshots/` folder has real screenshots of the Rowbly TUI for the website: the board, the Threads view, the factory controls, the Settings › AI › Models and Limits tabs and an open Story. Its `README.md` gives the alt text of each image. (ROW-55)
- Added: The factory starts its daemon again automatically after a crash, with a longer wait after each crash. After 5 crashes in a row, the factory stops with the `failed` phase, and `rowbly factory status` and the TUI factory screen show the restart count and the time of the last crash. (ROW-67)
- Added: The `README.md` file and the npm package page have a link to the rowbly.com website. The `package.json` file has the `homepage` key with the value `https://rowbly.com`. (ROW-57)
- Changed: Each page of the rowbly.com website has a "Skip to content" link and a clear focus ring on each control for keyboard users. The home page loads its board screenshots as WebP files, so that it is approximately 40% smaller. (ROW-56)
- Added: Each Story file has the `createdAt` and `updatedAt` keys, and Rowbly sets `updatedAt` at each change to the Story. `rowbly story get` and the General tab of the TUI Story form show the two times, and the new `display.timeZone` option (`rowbly project update --time-zone <zone>` or the Time zone field in Settings › Display) sets the time zone of the TUI. (ROW-26)
- Fixed: The TUI Story list shows no blank line below the Panel title when the list is longer than the Panel. The `↑ n more` and `↓ n more` lines show only when Stories are above or below the visible rows, and the list uses the free lines for Story rows. (ROW-68)
