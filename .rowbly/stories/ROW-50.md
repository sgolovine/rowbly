---
title: Build the How it works and Watch everything live landing sections
stage: DONE
position: 58
uid: f64c047d-9335-4a6f-8800-f686eab3f8ff
createdAt: 2026-11-14T23:14:02.000Z
updatedAt: 2026-11-15T00:55:09.000Z
worktree: /home/sgolovine/Projects/rowbly-worktrees/ROW-50
pull_request: https://github.com/sgolovine/rowbly/pull/246
---

## Goal

Build two sections of the landing page (`/`): "How it works" (four steps) and "Watch everything live". Together they explain the method of Rowbly and answer the question of the visitor: "can I trust it?". The visitor learns the four steps from idea to pull request, and sees that a person can read, interrupt and resume each agent at all times.

## Scope

In scope:

### How it works (section 3.4 and section 4 of the Spec `website-content-plan`)

- A `Section` with `id="how-it-works"`.
- Headline (an `<h2>` through `Section`): **Four steps from idea to pull request.**
- Four numbered cards in an ordered list (`<ol>`). On desktop (`md` and wider) they are one row. On mobile they are a stack. Each card has a step number, a bold title, the copy and a small illustration:
  1. **Write a Story.** One line is enough: "Add an undo button for two-player games." It lands in Backlog.
  2. **Tell each Stage what to do.** In plain English. Refinement: "Turn this into a spec with acceptance criteria." Development: "Build it, open a PR, move it to review." Review: "Review the PR." Set it once.
  3. **Start the factory.** Press `f` then `s`. A supervisor picks which Stories get work. Workers take one Story each, on their own branch, in their own conversation, up to as many as you allow. Show `f` and `s` with the `Kbd` component.
  4. **Watch, nudge, merge.** Stories move across the board on their own. Read any agent's conversation, interrupt it, or answer when it is blocked. When a PR is ready, you merge it. Close the UI; the factory keeps going.
- A link below the cards: "More about how it works" to `/how-it-works` (use the TanStack Router `Link`).

### Watch everything live (section 3.5 of the Spec)

- A `Section` with `id="watch-live"`.
- Headline: **Never wonder what an agent is doing.**
- Copy (the subhead): "Every Story shows which agent is on it. Open Threads to read any conversation as it happens. Interrupt it, give it a hint, resume it. When an agent is blocked, it raises its hand and shows up in Attention so you can unblock it and move on."
- Visual: a two-pane mock in `TerminalFrame`, made with HTML and CSS (not an image).
  - Left pane: one Story card with its key (for example `TTT-59`, in `text-brand-story-key`), its title and its `AgentTag` (for example `claude-19` / `In Development`).
  - Right pane: a Threads conversation that types out line by line (about 4 to 6 short lines, for example a worker that reads the code, writes a plan and asks for a design decision). After the last line, an Attention banner slides in with the text "Blocked: needs a design decision".
  - The animation loops slowly (one loop for each section, ease-out, no bounce). It runs only when the section is on screen.
- Three chips below the mock: **Read**, **Interrupt**, **Resume** (the shadcn `Badge` or a similar existing component).
- Add both sections to `website/src/routes/index.tsx`, after the existing sections, in this order: How it works, then Watch everything live.

Not in scope:

- The `/how-it-works` page itself (ROW-52). This Story only links to it.
- The animated board section `#see-it-work` (ROW-49) and the closing sections (ROW-51).
- New screenshots (ROW-55). See "Assumptions".
- New image files. The illustrations are inline SVG or HTML/CSS.
- A CHANGELOG entry. The `Changelog` Stage adds it.

## Acceptance criteria

- [ ] `/` shows a section with `id="how-it-works"`, the `<h2>` "Four steps from idea to pull request." and an `<ol>` with four items in the order of section 4 of the Spec.
- [ ] Step 3 shows `f` and `s` as `<kbd>` elements (the `Kbd` component).
- [ ] The section has a link with the text "More about how it works" and `href="/how-it-works"`.
- [ ] `/` shows a section with `id="watch-live"`, the `<h2>` "Never wonder what an agent is doing.", the copy of section 3.5, the two-pane mock in a `TerminalFrame` and the chips Read, Interrupt and Resume.
- [ ] The prerendered `dist/client/index.html` (after `pnpm --dir website build`) has the full text of the four steps, the full conversation text and the Attention banner text. A visitor without JavaScript sees all the text.
- [ ] At a viewport width of 360 px, the four steps are a single column, the text is readable and the page has no horizontal scroll. A person examines this in a browser.
- [ ] With `prefers-reduced-motion: reduce`, the conversation does not type and the banner does not slide. The full conversation and the banner show at once. A person examines this in a browser with reduced motion on.
- [ ] Screen readers get the full conversation text one time. The typing letters are `aria-hidden` or the full text is in an `sr-only` element (as `CountUp` does).
- [ ] The animation pauses when the section is off screen.
- [ ] The visible copy of the two sections matches the Spec `website-content-plan`, sections 3.4, 3.5 and 4, word for word.
- [ ] This command finds no match in the new section components: `grep -niwE "daemon|worktree|lock|flock|pi|runtime|harness|orchestration" <the new files>`. (The words in code identifiers are not visible copy, but keep them out also.)
- [ ] The new code uses only the brand colours of `website/src/styles/app.css`. It adds no other hues.
- [ ] `pnpm lint`, `pnpm --dir website typecheck` and `pnpm --dir website build` pass from the root of the repository.

## Technical notes

- The website is in `website/`, a separate pnpm package (TanStack Start, Tailwind CSS v4, shadcn/ui). Read `website/README.md` first. Do not add website dependencies to the root package.
- Put the new components in `website/src/components/landing/` with dash-case file names, for example `how-it-works.tsx` (exports `HowItWorks`) and `watch-live.tsx` (exports `WatchLive`). Follow the style of `hero.tsx`, `proof-strip.tsx` and `count-up.tsx`.
- Use the shared components: `Section` (`section.tsx`), `TerminalFrame` (`terminal-frame.tsx`), `Kbd` (`kbd.tsx`), `AgentTag` (`agent-tag.tsx`), `Card` and `Badge` (`ui/`).
- Motion: CSS keyframes and transitions, or a small React state machine for the typing. Put new keyframes in `website/src/styles/app.css`. Start each animation only inside the `@media (prefers-reduced-motion: no-preference)` block or with the `motion-safe:` variant. A JS animation must check `window.matchMedia("(prefers-reduced-motion: reduce)")` and show the final state at once, as `CountUp` does. Use `IntersectionObserver` to start and pause the loop when the section is on screen. The server render must show the final state (full text and banner) so that the prerendered HTML has all text.
- The real TUI facts for the mock: the Threads tab of a Story lists its threads, and an open thread shows the conversation. The keys are `x` (interrupt) and `r` (resume) (`src/tui/screens/stories/threads-tab/threads-tab-view.ts`). The factory shows blocked items in Attention (`src/tui/screens/factory/factory-attention/`). The mock does not need to show keys.
- Use the words of section 6 of the Spec ("Use" list). Do not use the words of the "Do not use on the site" list.
- ROW-49 (in development) and ROW-51 also add sections to `website/src/routes/index.tsx`. Expect a small merge conflict there. The final order of the page is: Hero, proof strip, `#see-it-work`, How it works, Watch everything live, then the sections of ROW-51.
- Do not write tests for the website (there is no website test setup, and the project rules exclude UI tests).

## Assumptions

- Step 3 includes the words "up to as many as you allow", as section 4 of the Spec says. The first text of this Story did not have them. Reason: an acceptance criterion says that the copy matches the Spec.
- The mock is built from the TUI code, not from screenshots. Reason: ROW-55 (the real screenshots) is not done. When ROW-55 is done, a later change can adjust the mock.
- The step illustrations are small inline SVG or HTML/CSS drawings (for example a Story card, a prompt line, the keycaps `f` `s`, and a merged PR mark). Reason: section 7 of the Spec allows CSS/SVG only, and no image for the steps exists.
- The section ids are `how-it-works` and `watch-live`. Reason: the Spec gives no ids, and these ids are short and match the headlines.
- The names, Story key and conversation lines of the mock are invented demo data in the Tic-Tac-Toe theme of the Hero screenshot. Reason: the site uses this demo Project in the other sections, and the mock must not show private data.
- The chips are static labels, not buttons. Reason: the Spec only says "Chips", and a button with no action confuses users.
