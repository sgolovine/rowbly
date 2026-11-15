---
title: Build the Install page
stage: IN_DEVELOPMENT
position: 1
worktree: /home/sgolovine/Projects/rowbly-worktrees/ROW-53
pull_request: null
---

## Goal

Visitors who want to try Rowbly need one short page that shows the requirements, the first commands and the first factory run. The page must be honest about Linux and costs. Replace the placeholder `/install` page with this page. Link to the README for all other detail.

## Scope

In scope: the content of the route `website/src/routes/install.tsx`. The page has these sections, in this order. Each step (2 to 5) is a numbered card with one or more copyable commands (`InstallCommand`).

1. **Requirements** (first section, not a numbered step): Node 22.19 or later. Git. The factory runs on Linux today. The board and the CLI work without a provider sign-in. Key line, verbatim: "You can use the board on any platform. The factory itself runs on Linux today."
2. **Install:** `npm install -g rowbly`. Text: you can also use `npx rowbly` without a global install (give `npx rowbly` its own `InstallCommand`).
3. **First run:** `cd your-repo`, then `rowbly`. Text: onboarding asks for a project name, Stages and agent skills. The defaults are fine.
4. **Sign in to a provider:** `rowbly auth login`. Text: pick a supervisor model, a worker model and a worker limit in Settings > AI, or with the CLI: `rowbly factory configure --supervisor <provider/model> --worker <provider/model> --max-workers 4`.
5. **Start the factory:** press `f` then `s` in the board (show the keys with `Kbd`), or run `rowbly factory start`.
6. **Costs:** verbatim: "Rowbly is free. Your model provider bills you for the models you use."
7. **Keys:** "Your keys stay on your machine. Rowbly sends them only to the provider you signed in to." (see Assumptions for the check of this claim).
8. A link "Read the full docs on GitHub" to `DOCS_URL` (the README).

Not in scope:
- A change to the landing page `#install` section (ROW-51, done). It says "Node 22 or later"; do not change it in this Story.
- Page-specific SEO metadata, canonical URL and sitemap (ROW-54).
- A change to `InstallCommand`, `Section`, `Kbd`, the header or the footer, except a small prop addition if it is necessary.
- A change to the README or to the CLI.

## Acceptance criteria

- [ ] `pnpm --dir website build` writes `website/dist/client/install/index.html`, and this file contains the text of all sections (static prerender, so a deep link to `https://rowbly.com/install` loads the page directly).
- [ ] The first section of the page is Requirements, and it contains "The factory itself runs on Linux today." and "Node 22.19 or later".
- [ ] The page shows these commands, each in an `InstallCommand` with a copy button: `npm install -g rowbly`, `npx rowbly`, `cd your-repo`, `rowbly`, `rowbly auth login`, `rowbly factory configure --supervisor <provider/model> --worker <provider/model> --max-workers 4`, `rowbly factory start`.
- [ ] Each command and each flag on the page exists in the current CLI (`rowbly --help`, `rowbly auth login --help`, `rowbly factory configure --help`, `rowbly factory start --help`).
- [ ] The page contains the verbatim lines "You can use the board on any platform. The factory itself runs on Linux today." and "Rowbly is free. Your model provider bills you for the models you use."
- [ ] Steps 2 to 5 are numbered cards in order: Install, First run, Sign in to a provider, Start the factory.
- [ ] The page has a link with the text "Read the full docs on GitHub" to `DOCS_URL` from `website/src/lib/site.ts`.
- [ ] The page text does not use the words in the "Do not use on the site" list of the Spec `website-content-plan`, section 6 (daemon, worktree, lock, flock, Pi SDK, runtime, and so on).
- [ ] The page uses only the brand colours of `website/src/styles/app.css`. A person examines the page at a mobile width (375 px) and a desktop width: no horizontal page scroll, and the long `factory configure` command scrolls inside its `InstallCommand`.
- [ ] Root `pnpm lint`, `pnpm --dir website typecheck` and `pnpm --dir website build` pass.

## Technical notes

- The route already exists as a placeholder: `website/src/routes/install.tsx`. The header links to `/install`. `vite.config.ts` has `crawlLinks: true`, so the prerender finds `/install` through the header link. Add `{ path: "/install" }` to `pages` in `vite.config.ts` only if the build does not write `install/index.html`.
- Shared components (from ROW-47): `Section` (`section.tsx`), `InstallCommand` (`install-command.tsx`, prop `command`), `Kbd` (`kbd.tsx`), `Card` (`components/ui/card.tsx`). URLs are in `src/lib/site.ts` (`DOCS_URL`). See `website/README.md`.
- Put page parts in `website/src/components/install/` if the route file becomes large. Use dash-case file names. Follow the root lint rules (`pnpm lint` checks `website/`).
- Facts, checked in the code:
  - `package.json` `engines.node` is `>=22.19.0`.
  - README "Prerequisites": native factory execution needs Linux, Git and util-linux `flock` (do not name `flock` on the site); the board and read-only history work without provider credentials.
  - `npx rowbly` is in the README "First start".
  - Onboarding (`docs/architecture/onboarding.md`) asks "defaults or customize", then name and key, Stages and agent skills. It does not ask for prompts; it creates empty user prompts.
  - `rowbly auth login [provider] [--type oauth|api_key]` (`src/commands/auth/auth.ts`). It must run in an interactive terminal.
  - `rowbly factory configure` has `--supervisor`, `--worker` and `--max-workers` (`src/commands/factory/factory.ts`).
  - `rowbly factory start` exists. In the TUI, `f` opens Factory controls and `s` starts the factory (README "Factory controls").
  - Settings > AI has the tabs Providers, Models and Limits (README "Provider sign-in and models").
  - Credentials stay in Pi storage, outside the Project (`docs/architecture/native-factory/pi-runtime-and-auth.md`, README).
- Voice: short sentences, see the Spec `website-content-plan`, section 6.
- Depends on ROW-45 and ROW-47 (both done). ROW-52 builds `/how-it-works` in parallel; do not change its files.

## Assumptions

- The page says "Node 22.19 or later", not "Node 22 or later". Reason: `engines.node` is `>=22.19.0` and the README says the same. The Story asks for an honest page.
- First run says "a project name, Stages and agent skills", not "a project name, Stages and prompts". Reason: the onboarding steps in `docs/architecture/onboarding.md` do not ask for prompts.
- The Keys line is kept as written. Reason: the auth docs and the README say that credentials stay in local Pi storage outside the Project, and Rowbly has no server; Pi uses a credential only for requests to its provider. This check replaces the "check this claim" note of the original Story.
- `factory configure` is shown with `<provider/model>` placeholders and a copy button. Reason: the model IDs depend on the provider of the user; the README shows the same form. "Every command runs" means that each command and flag exists in `--help`.
- `cd your-repo` gets its own `InstallCommand`. Reason: the landing page install section (Spec 3.10) uses the same command list, and "each command has a copy button".
- The Keys line and Costs are short text blocks after the numbered cards, not numbered cards. Reason: the Spec section 5 lists them as page content, not as steps, and they have no commands.
