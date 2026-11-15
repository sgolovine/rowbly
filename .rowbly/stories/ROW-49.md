---
title: Build the animated board section of the landing page
stage: CHANGELOG
position: 1
worktree: /home/sgolovine/Projects/rowbly-worktrees/ROW-49
pull_request: https://github.com/sgolovine/rowbly/pull/245
---

## Goal

Build the "Stories move themselves" section of the landing page (`/`): an animated board that teaches the main loop of Rowbly in ten seconds. A visitor sees Stories move across the board, sees an agent work on each Story in a working Stage, and can read the Stage prompt of each working column.

## Scope

In scope:

- A section with `id="see-it-work"` (the target of the **See it work** button of ROW-48).
- Headline (an `<h2>` through `Section`): **Stories move themselves.**
- Copy (the subhead): "You write a Story in a sentence. The factory picks it up, refines it into a spec, builds it on its own branch, opens a PR and moves it to review. You read the PR and press merge."
- An animated board in `TerminalFrame`, with five columns in this order: **Backlog**, **In Refinement**, **In Development**, **In Review**, **Done**.
- Six cards. Each card shows a Story key (in `text-brand-story-key`, mono) and a short title from the Tic-Tac-Toe screenshot (`assets/screenshot.png`). Use these cards and agents:
  - `TTT-41` Add an undo button for two-player games (`claude-1`)
  - `TTT-43` Add sound effects for moves and wins (`claude-3`)
  - `TTT-50` Create and join game rooms by code (`claude-10`)
  - `TTT-53` Add turn timers for online games (`codex-13`)
  - `TTT-59` Design the ranked matchmaking flow (`claude-19`)
  - `TTT-62` Scope the daily puzzle mode (`gemini-23`)
- The loop: one move about every 2 s. In each move, one card goes one column to the right. When a card is in In Refinement, In Development or In Review, it shows `AgentTag` (its agent and the Stage label) and a blinking amber cursor (`_` with the existing `cursor-blink` class). In Backlog and Done, the card has no tag. A card that is in Done goes back to Backlog on a later move (fade out, fade in), so the loop never ends and the board never becomes empty.
- Column headers of the three working columns are buttons that show the Stage prompt in a tooltip on hover and on keyboard focus:
  - In Refinement: "Turn this Story into a spec with acceptance criteria."
  - In Development: "Build it, open a PR, move it to In Review."
  - In Review: "Review the PR."
  Backlog and Done have no prompt and no tooltip. Their headers are plain text.
- Motion: CSS transitions and keyframes with ease-out only, no bounce. The animation pauses when the section is off screen and when the browser tab is hidden.
- A small **Pause** / **Play** button for the animation (see "Assumptions").
- With `prefers-reduced-motion: reduce`: a static board with cards in all five columns, the agent tags in the working columns, no cursor blink, no moves and no Pause button.
- Small screens: the board is a horizontal scroll inside the frame (the columns keep a readable minimum width). The page itself has no horizontal scroll.

Not in scope:

- The Hero and the proof strip (ROW-48), and the other landing sections (ROW-50, ROW-51).
- Changes to the shared components of ROW-47, except a small optional prop if one is necessary.
- An animation library (for example `motion`). This Story uses CSS and React only.
- The full accessibility, Lighthouse and page weight check (ROW-56).

## Acceptance criteria

- [ ] `pnpm --dir website build` passes, and the built `website/dist/client/index.html` has an element with `id="see-it-work"`, the exact headline "Stories move themselves." and the exact copy of "Scope" (Spec `website-content-plan`, section 3.3). A `grep` examines this.
- [ ] The built `index.html` has the five column labels (Backlog, In Refinement, In Development, In Review, Done) and the six Story keys of "Scope" in the static HTML. The server render is the static board with cards in all five columns.
- [ ] The three Stage prompt texts of "Scope" are in the source of the board component exactly as written. A `grep` of `website/src/` examines this.
- [ ] The built site has none of the words in "Do not use on the site" of the Spec section 6 (for example daemon, worktree, lock, orchestration) in this section. A `grep` of the new files examines this.
- [ ] No file in `website/src/` other than `website/src/styles/app.css` has a hex, `rgb(` or `hsl(` colour, or a Tailwind default palette colour class. A `grep` examines this.
- [ ] `website/package.json` has no new dependency.
- [ ] All new animation CSS (card moves, fades, cursor, tooltip animation) is in a `@media (prefers-reduced-motion: no-preference)` block or uses the Tailwind `motion-safe:` variant. The loop code checks `window.matchMedia("(prefers-reduced-motion: reduce)")` and does not start when it matches. A code review examines this.
- [ ] The loop uses an `IntersectionObserver` and the `visibilitychange` event, and it schedules no timer while the section is off screen or the tab is hidden. A code review examines this.
- [ ] `pnpm --dir website typecheck` passes after a build.
- [ ] The root `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build` pass.
- [ ] (A person examines this.) In `pnpm website:dev`, a card moves one column to the right about every 2 s. An agent tag with a blinking cursor shows on cards in the three working columns, and not in Backlog or Done. The loop continues for at least one minute with no empty board.
- [ ] (A person examines this.) The loop causes no layout shift: the section height does not change during the loop (Chrome DevTools Performance panel shows no layout shift for the section). With the tab idle on the section, the Chrome DevTools Performance monitor shows less than 5% CPU.
- [ ] (A person examines this.) When the section scrolls off screen, the moves stop. They start again when the section comes back.
- [ ] (A person examines this.) Tab moves focus to the In Refinement, In Development and In Review headers, and each shows its Stage prompt tooltip on focus. Escape closes the tooltip. Hover shows the same tooltips.
- [ ] (A person examines this.) With reduced motion turned on in the browser DevTools (Rendering > Emulate CSS `prefers-reduced-motion: reduce`), the board is static, with cards in all five columns and no blink.
- [ ] (A person examines this.) From 360 px to 1440 px wide, the page has no horizontal scroll. Below the width of the full board, the board scrolls horizontally inside its frame and the cards stay readable.

## Technical notes

- **Dependency.** ROW-47 (layout and shared components) is merged on `origin/main`. ROW-48 (Hero and proof strip) is in development and also changes `website/src/routes/index.tsx` and maybe `website/src/styles/app.css`. The worktree of this Story was made from an older commit with no ROW-47 work. Merge `origin/main` into the branch before the work.
- **Files** (dash-case names, PascalCase exports):
  - `website/src/components/landing/see-it-work.tsx` (`SeeItWork`): the section, with `Section` (`id="see-it-work"`, `headline`, `subhead`) and the board.
  - `website/src/components/landing/animated-board.tsx` (`AnimatedBoard`): the board, the columns, the cards, the tooltips, the loop and the Pause button.
  - Optional: `website/src/components/landing/board-loop.ts`: the card data and a pure function that gives the column of each card for a step number. This keeps the loop logic small and easy to read.
  - `website/src/routes/index.tsx`: render `<SeeItWork />` after the existing content. If ROW-48 is on `main` at merge time, put it after `<ProofStrip />`. Keep this change to one line, so that a merge with ROW-48 is easy.
- **Shared components** of ROW-47: `Section` (props `id`, `eyebrow`, `headline`, `subhead`, `children`, `className`; the headline is an `<h2>`), `TerminalFrame` (props `children`, `glow`, `className`), `AgentTag` (props `agent`, `stage`, `className`). Use `Tooltip`, `TooltipTrigger`, `TooltipContent` and `TooltipProvider` from `@/components/ui/tooltip` (Radix). Use `Button` from `@/components/ui/button` for the Pause button.
- **No layout shift.** Give the board a fixed height (enough for the largest number of cards in one column, which is the full card count in the worst case, or limit the loop so that one column never has more than three cards). Position the cards absolutely inside the board: `left` from the column index (each column is 20% of the board width) and `top` from the slot index in the column. Move a card with a CSS `transform` or `left`/`top` transition of about 600 ms with an ease-out curve. Prefer `transform` so that the move needs no layout.
- **Loop design.** One `setTimeout` chain with a 2 s delay, or one `setInterval` that you clear on pause. A step changes React state one time. Do not use `requestAnimationFrame` for the loop. Pause when the `IntersectionObserver` reports that the section is not visible, when `document.hidden` is true, and when the user presses Pause. Disconnect the observer and remove the listeners on unmount.
- **Server render and hydration.** The first render (server and client) is the static board, with cards in all five columns. On the client, after mount, start the loop only if motion is allowed. This prevents a hydration mismatch and gives the reduced-motion board with no extra code.
- **Cursor.** Reuse the `cursor-blink` class of `app.css` (it is already inside a `prefers-reduced-motion: no-preference` block). Add new keyframes (for example a card fade) only to `website/src/styles/app.css`, inside a `prefers-reduced-motion: no-preference` block.
- **Tooltip.** The shadcn/ui `TooltipContent` uses `tw-animate-css` classes. Add `motion-reduce:animate-none` to the content of this Story, or wrap the animation classes with `motion-safe:`. Radix tooltips open on keyboard focus and close on Escape. The trigger must be a focusable element (`<button type="button">`).
- **Screen readers.** Put the moving cards in an element with `aria-hidden="true"`, so that a screen reader does not read each move. Give the board container an `aria-label`, for example "An animated Rowbly board. Stories move from Backlog to Done, and an agent works on each Story in Refinement, Development and Review." The column header buttons stay accessible.
- **Small screens.** The board has a minimum width (for example `min-w-[720px]`) inside an `overflow-x-auto` element in the frame. Keep the card text at `text-xs` to `text-sm`. Truncate long titles with `truncate` or `line-clamp-2`.
- **Theme.** Use only the theme tokens (`bg-brand-background`, `bg-brand-surface`, `border-brand-border`, `text-brand-accent`, `text-brand-text`, `text-brand-muted`, `text-brand-story-key`, and the shadcn/ui mapped classes). Amber means "live": use it only for the agent tag, the cursor and the focus ring.
- **Voice.** Do not use the words in "Do not use on the site" of the Spec (for example daemon, worktree, lock, orchestration).
- No unit tests: the website has no test runner, and the repository rules do not ask for website tests.
- The strict code-style skill applies only to `src/` of the CLI, not to `website/`. Biome applies to `website/`.

## Assumptions

- No animation library. Reason: the Story allows a small library only if necessary, and CSS transitions with React state can do one move every 2 s. This is the smallest change and adds no dependency.
- The board has six cards with the keys, titles and agents of "Scope", taken from `assets/screenshot.png`. Reason: the Story asks for titles from the Tic-Tac-Toe screenshot and names `TTT-41`. Six cards are enough to fill five columns and keep the board readable.
- Each card keeps one agent for all working Stages. Reason: it is simpler to follow for a visitor, and the Story only says that a tag appears in working columns.
- A card in Done goes back to Backlog later, so the loop never ends. Reason: the Story asks for a slow loop, and the board must not become empty.
- The agent tags use real agent names of the screenshot (`claude-1`, `codex-13`, `gemini-23` and others), not the examples `claude-4` and `codex-7` of the original text. Reason: the Story says "for example", and the names of the screenshot keep the site consistent with the Hero image.
- The tooltip for In Refinement says "Turn this Story into a spec with acceptance criteria." Spec section 4 says "Turn this into a spec ...". Reason: the Story gives this exact text for the tooltip, and it is clear without the step text around it.
- Small screens use a horizontal scroll inside the frame, not a vertical list. Reason: the Story allows both, and the scroll keeps one layout and one animation.
- The section has a Pause / Play button. Reason: the loop never ends, and WCAG 2.2.2 (Pause, Stop, Hide) asks for a control for moving content that lasts more than 5 s. The button is small and it saves rework in ROW-56.
- The static reduced-motion board is also the server render and the first client render. Reason: it prevents a hydration mismatch, and the built HTML shows a full board without JavaScript.
- `SeeItWork` goes after the existing content of `index.tsx` (after `ProofStrip` if ROW-48 is merged). Reason: Spec section 3 gives the order Hero, Proof strip, Stories move themselves.

## Review findings

- The changelog step found a merge conflict with `origin/main` in `website/src/routes/index.tsx`. The merge was aborted. ROW-48 is now on `main`: it imports `Hero` and `ProofStrip` and renders `<Hero />` and `<ProofStrip />` in place of the placeholder `rowbly_` heading. Merge `origin/main` into `story/ROW-49`. Keep the `Hero` and `ProofStrip` imports and elements, add the `SeeItWork` import, and render `<SeeItWork />` after `<ProofStrip />`. Then run the checks again and push.
