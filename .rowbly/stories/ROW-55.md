---
title: Capture real TUI screenshots for the website
stage: DONE
position: 63
worktree: /home/sgolovine/Projects/rowbly-worktrees/ROW-55
pull_request: https://github.com/sgolovine/rowbly/pull/251
---

## Goal

Capture real, current screenshots of the Rowbly TUI for the website, so that the website mocks match the product. The images come from the real built CLI, not from screens that a person draws.

## Scope

In scope:

- Use the `rowbly-screenshots` skill (`.agents/skills/rowbly-screenshots/SKILL.md`) with a demo Project in a temporary folder, not the `.rowbly/` folder of the Rowbly repository. Use an isolated `HOME`.
- Capture these five views at a wide terminal size (minimum 160 columns × 45 rows):
  1. `board.png`: the board with many Stories in working Stages and agent tags. This is the new equivalent of `assets/screenshot.png`, with the current version number in the footer.
  2. `threads.png`: the Threads view with a conversation open (Peek or the conversation reader).
  3. `factory-controls.png`: Factory controls with the supervisor model, the worker counts and minimum one item in the `Attention` list.
  4. `settings-models.png`: Settings > AI > Models (supervisor model, worker model) and Limits. If Models and Limits are on different screens, capture `settings-limits.png` also.
  5. `story-general.png`: an open Story with its General tab and a linked Spec.
- Put the images in `website/public/screenshots/` with dash-case names. Create the folder if it does not exist.
- Write alt text for each image in `website/public/screenshots/README.md` (STE).
- Change the line "Do not commit screenshots." in `docs/architecture/tooling.md` so that it permits the website images in `website/public/screenshots/`.

Not in scope:

- Changes to the website components or copy to use the new images. A different Story does this.
- Changes to `assets/screenshot.png` and `website/public/images/*`. ROW-48 cropped `board.png` and `board-no-tags.png` from `assets/screenshot.png`, and its copy describes that image.
- A committed script that makes the screenshots. A temporary script outside the repository is permitted.
- Changes to `src/`.

## Acceptance criteria

- [ ] `website/public/screenshots/` has minimum five PNG files: `board.png`, `threads.png`, `factory-controls.png`, `settings-models.png` and `story-general.png` (and `settings-limits.png` if Limits is a different screen).
- [ ] Each PNG is at 2x scale: `file website/public/screenshots/*.png` shows a width of minimum 2 × (columns × cell width in CSS px). A person examines that the text is crisp and that the grid is aligned (no shifted box-drawing lines).
- [ ] The images show the TUI colours of `theme`, not one-colour text. A person examines this.
- [ ] The footer of each image shows `v<version>` with the version of `package.json` at the time of capture (now `0.17.0`).
- [ ] No image has private data: no real API keys, real e-mail addresses, real user names, real home paths or private repository names. A person examines each image; `grep -ri` of the text captures for `sgolovine` and `@` e-mail patterns gives no result.
- [ ] `factory-controls.png` shows a supervisor model, worker counts and minimum one `Attention` row.
- [ ] `threads.png` shows a Thread list and an open conversation with minimum one user and one assistant message.
- [ ] `website/public/screenshots/README.md` has one entry for each PNG, with its file name and its alt text.
- [ ] No file in `.rowbly/` of the repository changes, and no real credential was used. `git status` shows only files in `website/public/screenshots/` and `docs/architecture/tooling.md`.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` and `pnpm website:build` pass.

## Technical notes

- Run the built CLI: `pnpm build`, then `node "$repo/dist/cli.js"` in agentic-tui, with `--cwd` the demo Project and `--env HOME="$out/home"`. See the `rowbly-screenshots` skill. Do not use `t resize`; start a new run for each size.
- **Colour and 2x.** The agentic-tui PNG (`node_modules/@codebolt/agentic-tui/dist/src/png-renderer.js`) draws one colour only, and some glyphs misalign. Use it only to check the layout. For the final images, render the real terminal output in headless Chrome (`/usr/bin/google-chrome` is installed) with `deviceScaleFactor: 2`:
  - `t output --mode snapshot` gives the raw ANSI output buffer of the session. Replay it in xterm.js (agentic-tui uses `@xterm/headless`; the browser `@xterm/xterm` package or an ANSI-to-HTML conversion is permitted) in a page, and take a screenshot of the terminal element.
  - If the ANSI route fails, render the `.txt` capture in a monospace HTML page with headless Chrome (memory note of this repository). Then the colour criterion is not satisfied; record this in the result problems.
  - Use the same font, background (`#282c34`, as in `assets/screenshot.png`) and window frame for all images.
  - Keep the temporary tools (for example a `node` script or `npx` packages) in `$out`, outside the repository. Do not add dependencies to the root `package.json` or to `website/package.json`.
- **Demo Project.** Make it in `$out/demo` with `git init` and `rowbly -C "$out/demo" init` (non-interactive flags, see `docs/architecture/onboarding.md` and `docs/architecture/cli.md`). Use fake names (for example a "Tic-Tac-Toe" project with key `TTT`, as in `assets/screenshot.png`). Create 15 to 25 Stories in many Stages with `rowbly story create`, and minimum one Spec linked to a Story (`rowbly spec ...`).
- **Threads, conversations and agent tags.** Thread metadata is in `.rowbly/runtime/threads/<id>.json` and the Pi history is in `.rowbly/runtime/sessions/<id>/<pi-name>.jsonl` (see `docs/architecture/native-factory/threads-and-history.md`). The TUI reads them without the daemon. Make the records from a real run (see the next item), or write them by hand in the demo Project in the formats that `src/services/thread/` and `src/services/conversation/` read. Use the tests of these services as examples of valid files.
- **Live factory for Attention.** `factoryProblems()` in `src/tui/screens/factory/factory-status.ts` shows `Attention` rows only when the factory is live (owner lock, a live process and a fresh heartbeat in `status.json`, see `getFactoryStatus()` in `src/services/factory/factory.ts`). A hand-written `status.json` without a live daemon shows no rows. To get a live factory without credentials:
  - In the isolated `HOME`, write a Pi custom provider in `$out/home/.pi/agent/models.json` (Pi `getAgentDir()` default) that points to a small local OpenAI-compatible stub server in `$out` with a fake key (for example `fake-key`). The stub returns fixed answers. See the Pi docs `docs/custom-provider.md` and `docs/models.md`.
  - Select the stub models as the supervisor and worker models in the demo Project, and start the factory with `rowbly -C "$out/demo" factory start`.
  - Get an attention entry from the real daemon, for example a stub answer that calls the supervisor tool `raise_attention`, or a Story that the manager marks as `upstream-stuck`.
  - Stop the factory with `rowbly -C "$out/demo" factory stop` before the end. Stop the agentic-tui daemon of `$out`.
- Never start a factory in the Rowbly repository or its canonical Project. Do not use the credentials of the user (the isolated `HOME` has none).
- The version comes from `package.json` (`src/tui/components/footer/footer.tsx`). Do not change the version.
- Alt text in `README.md` is STE. Describe what the screen shows, for example "The Rowbly board with 20 Stories in five Stages. Agent tags show the worker on each Story."

## Assumptions

- The new board image goes to `website/public/screenshots/board.png`. `assets/screenshot.png` and `website/public/images/` do not change. Reason: ROW-48 cropped `website/public/images/board*.png` from `assets/screenshot.png` and says that the copy and the stats must change together with a new board image. That change is a different Story.
- This Story changes the "Do not commit screenshots" rule in `docs/architecture/tooling.md` only for `website/public/screenshots/`. Reason: the Story asks for committed website images, and the rule otherwise forbids them.
- "Crisp at 2x" means a render with a device scale factor of 2 in headless Chrome. Reason: the agentic-tui PNG has one scale and one colour.
- The minimum terminal size is 160 × 45. Reason: "a wide terminal size" has no number; the skill example is 140 × 38, and the board needs space for many Stages and agent tags.
- A local stub provider in an isolated `HOME` is "fake activity", not a production faux-provider flag. Reason: it changes no code in `src/` and uses no live credentials, so it obeys the safety rules of `AGENTS.md`.
- If a live factory with an Attention row cannot be made, the developer writes the Thread files by hand, captures the other four views, and records the missing Attention row in the result problems. Reason: a question must not stop the Story.
