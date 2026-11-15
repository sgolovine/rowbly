---
title: Build the closing landing sections and the install call to action
stage: IN_REVIEW
position: 2
worktree: /home/sgolovine/Projects/rowbly-worktrees/ROW-51
pull_request: https://github.com/sgolovine/rowbly/pull/247
---

## Goal

Build the closing sections of the landing page (`/`): "Bring your own models", "The board is just files in your repo", "A terminal UI and a CLI", "Specs and attachments" and the final install call to action. After these sections, the visitor knows that Rowbly uses their own models, keeps the board in their repo, works from the keyboard and from scripts, and can be installed in two minutes.

## Scope

In scope (sections 3.6 to 3.10 of the Spec `website-content-plan`):

### 1. Bring your own models (section 3.6)
- A `Section` with `id="models"`.
- Headline: **Your models. Your limits. Your keys.**
- Copy: "Sign in to Anthropic, OpenAI, Google Gemini and more. Pick one model to supervise and another to do the work. Set how many workers run at once. Change your mind any time."
- Visual: provider names as plain text wordmarks (Anthropic, OpenAI, Google Gemini), not logos. Next to them, a static settings mock in a `TerminalFrame`, made with HTML and CSS, with three rows: "Supervisor model", "Worker model", "Worker limit". These are the labels of Settings › AI in the TUI.

### 2. The board is just files in your repo (section 3.7)
- A `Section` with `id="files"`.
- Headline: **The board is just files in your repo.**
- Copy: "Your Stories, Stages and Specs are Markdown and JSON in a `.rowbly/` folder. Commit them. Diff them. Branch them. Clone the repo and the board comes with it. No account, no sync, no vendor between you and your work."
- Visual: a short file tree (`.rowbly/` with `stories/`, `stages/`, `specs/`) next to one Story card. Do not show real schemas or file contents.

### 3. A terminal UI and a CLI (section 3.8)
- A `Section` with `id="tui-and-cli"`.
- Headline: **A terminal UI when you want to look. A CLI when you want to script.**
- Copy: "Open `rowbly` and work the board with your keyboard. Or drive it from the command line: `rowbly story create`, `rowbly factory status`. Your own scripts and agents can use the same commands."
- Visual: the shadcn `Tabs` (`website/src/components/ui/tabs.tsx`) with two tabs:
  - "TUI": the existing screenshot `/images/board.png` in a `TerminalFrame`, with alt text.
  - "CLI": the two commands with real output, as terminal text (see "Technical notes").

### 4. Specs and attachments (section 3.9, a small section)
- A `Section` with `id="specs"`.
- Headline: **Context that travels with the Story.**
- Copy: "Link a Markdown Spec to a Story so agents build what you meant. Paste a screenshot straight onto a Story. Everything stays next to the code."
- No large visual. A small icon or no visual is sufficient.

### 5. Final call to action (section 3.10)
- A `Section` with `id="install"`. The Hero "Get started" button links to `#install` now.
- Headline: **Start your factory in two minutes.**
- A terminal block with three lines: `npm install -g rowbly`, `cd your-repo`, `rowbly`, then the `rowbly_` cursor that blinks (use the existing `.cursor-blink` class of `app.css`).
- Copy: "Onboarding sets up your Stages and prompts. Sign in to a provider, press `f` then `s`, and watch the board move." Show `f` and `s` with the `Kbd` component.
- The honest line, in normal body text size and colour (not small print): "Free and open source under MIT. Needs Node 22 or later. The factory runs on Linux today."
- Buttons: **Get started** (TanStack Router `Link` to `/install`) and **View on GitHub** (`GITHUB_URL` from `src/lib/site.ts`).

Add the five sections to `website/src/routes/index.tsx`, after the "Watch everything live" section of ROW-50, in the order 1 to 5.

Not in scope:
- The `/install` page (ROW-53). This Story only links to it.
- New TUI screenshots (ROW-55). Use the existing images in `website/public/images/`.
- Provider logos.
- The sections of ROW-49 and ROW-50.
- A CHANGELOG entry. The `Changelog` Stage adds it.

## Acceptance criteria

- [ ] The prerendered `website/dist/client/index.html` (after `pnpm --dir website build`) has sections with the ids `models`, `files`, `tui-and-cli`, `specs` and `install`, in this order, after the section with `id="watch-live"`.
- [ ] Each of the five sections has an `<h2>` with the headline of the Spec, and the visible copy matches the Spec `website-content-plan`, sections 3.6 to 3.10, word for word.
- [ ] The "Bring your own models" section shows the provider names as text (no logo image) and a settings mock with the rows "Supervisor model", "Worker model" and "Worker limit".
- [ ] The files section shows a file tree with `.rowbly/`, `stories/`, `stages/` and `specs/`.
- [ ] The CLI tab shows `rowbly story create` and `rowbly factory status` with output that comes from a real run of Rowbly 0.17.0 (or the current version of `package.json`). The developer records the commands of that run in the pull request description.
- [ ] The TUI tab and the CLI tab change with the mouse and with the keyboard (arrow keys), as the Radix Tabs do. A person examines this in a browser.
- [ ] The `#install` section has the three commands, the blinking `rowbly_` cursor, the Linux line in body text size, a **Get started** link with `href="/install"` and a **View on GitHub** link to `https://github.com/sgolovine/rowbly`.
- [ ] With `prefers-reduced-motion: reduce`, the cursor does not blink. A person examines this in a browser.
- [ ] At a viewport width of 360 px, the page has no horizontal scroll, and the text of all five sections is readable. A person examines this in a browser.
- [ ] This command finds no match in the new files: `grep -niwE "daemon|worktree|lock|flock|pi|runtime|harness|orchestration|schema" <the new files>`.
- [ ] The new code uses only the brand colours of `website/src/styles/app.css`.
- [ ] `pnpm lint`, `pnpm --dir website typecheck` and `pnpm --dir website build` pass from the root of the repository.

## Technical notes

- The website is in `website/`, a separate pnpm package (TanStack Start, Tailwind CSS v4, shadcn/ui). Read `website/README.md` first. Do not add website dependencies to the root package.
- Put the new components in `website/src/components/landing/` with dash-case file names, for example `bring-your-models.tsx`, `files-in-repo.tsx`, `tui-and-cli.tsx`, `specs-and-attachments.tsx` and `install-cta.tsx`. Follow the style of `hero.tsx`, `proof-strip.tsx` and `see-it-work.tsx`.
- Use the shared components: `Section`, `TerminalFrame`, `InstallCommand`, `Kbd`, `Card`, `Badge`, `Button` and `Tabs`.
- Dependency: ROW-50 (in development) adds the "How it works" and "Watch everything live" sections to `index.tsx`. Start from the main branch after ROW-50 is merged. If ROW-50 is not merged, add the sections after the last section on the main branch, and expect a small merge conflict in `index.tsx`. The final page order is: Hero, proof strip, `#see-it-work`, `#how-it-works`, `#watch-live`, then the five sections of this Story.
- The real CLI output (Rowbly 0.17.0, recorded during refinement in a new demo Project in a temporary directory, made with `rowbly init --defaults --name "Tic Tac Toe" --key TTT --stage BACKLOG --no-skills`):
  - `rowbly story create --title "Add an undo button for two-player games"` prints `Created TTT-01 in BACKLOG`.
  - `rowbly factory status` with the factory stopped prints:
    ```
    {
      "version": 1,
      "phase": "stopped"
    }
    ```
  - The developer runs the same commands again with the current build (`pnpm build`, then `node dist/cli.js -C <temp dir> ...`) and uses that output. Do not run them in the Rowbly repository. Do not use the output of a running factory, because it has local paths and internal words.
- The labels of the settings mock come from `src/tui/screens/settings/ai-models-page/ai-models-page.tsx` ("Supervisor model", "Worker model") and `ai-limits-page.tsx` ("Worker limit"). The model names in the mock are demo values, for example `anthropic/claude-opus` and `openai/gpt`, and a limit of `4`.
- The `.cursor-blink` class and its reduced-motion rule are in `website/src/styles/app.css`.
- Use the words of section 6 of the Spec ("Use" list). Do not use the words of the "Do not use on the site" list.
- Do not write tests for the website (no website test setup exists, and the project rules exclude UI tests).

## Assumptions

- The provider names are plain text wordmarks, not logos. Reason: the Story says so, and question 1 of section 9 of the Spec (logos need approval) has no answer.
- The TUI tab uses the existing `/images/board.png`. Reason: ROW-55 (new screenshots) is not done. A later change can replace the image.
- The CLI tab shows `rowbly factory status` with a stopped factory. Reason: the output of a running factory has local paths and words that section 6 of the Spec forbids. The stopped output is real and short.
- The section ids are `models`, `files`, `tui-and-cli`, `specs` and `install`. Reason: the Spec gives only `#install`, and these ids are short and match the headlines.
- The "Get started" button of the final call to action goes to `/install`, not `#install`. Reason: the Story says so, and the button is already in the `#install` section.
- "Needs Node 22 or later" stays as the Spec says, although `package.json` has `engines.node >=22.19.0`. Reason: the copy must match the Spec word for word. ROW-53 can give the exact version on the Install page.
- The acceptance criterion "after Watch everything live" applies to the main branch after ROW-50 is merged. Reason: ROW-50 is in development now.

## Review findings

- The merge of `origin/main` (bc8cdba1) into `story/ROW-51` has a conflict in `website/src/routes/index.tsx`. ROW-50 is merged on main now. It adds the `HowItWorks` and `WatchLive` imports and sections at the same lines as the five sections of this Story.
- Repair: merge `origin/main`. Keep all imports of the two sides. Use this order in `HomePage`: `Hero`, `ProofStrip`, `SeeItWork`, `HowItWorks`, `WatchLive`, `BringYourModels`, `FilesInRepo`, `TuiAndCli`, `SpecsAndAttachments`, `InstallCta`. Then examine the acceptance criterion about the order after `id="watch-live"` in the prerendered `index.html`.
