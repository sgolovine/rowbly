---
title: Build the landing page Hero and proof strip
stage: CHANGELOG
position: 1
worktree: /home/sgolovine/Projects/rowbly-worktrees/ROW-48
pull_request: https://github.com/sgolovine/rowbly/pull/244
---

## Goal

Build the first two sections of the landing page (`/`): the Hero and the proof strip. In the first screen, a visitor must understand what Rowbly is and how much it can do.

## Scope

In scope:

### Hero
- Headline (the only `<h1>` of the page): **Your backlog, built by a factory of agents.**
- Subhead: "Rowbly is a software factory manager that lives in your terminal. Put Stories on a board. Tell each Stage what to do. Start the factory, and a team of AI agents refines, builds, opens PRs and reviews, all at once, while you watch."
- CTAs, in this order:
  - `InstallCommand` with its default command `npm install -g rowbly`.
  - Button **Get started**: a link with `href="#install"` (scrolls to the install section).
  - Button **See it work**: a link with `href="#see-it-work"` (scrolls to the board animation).
  - Text link **Star on GitHub** to `https://github.com/sgolovine/rowbly` (with the `Star` icon of `lucide-react`).
- Trust row: "Free. Open source. MIT. Bring your own models."
- Visual: the screenshot, cropped to the board, in `TerminalFrame` with `glow`. On load, the agent tags fade in one after the other (about 1.5 s total). With `prefers-reduced-motion: reduce`, all tags show at once, with no motion.

### Proof strip
- Headline: **One board. Twenty-six agents. All at the same time.**
- Copy: "This is a real Rowbly board. Eight Stories being refined, ten being built, eight under review, each one with its own agent and its own branch. Nobody is waiting on anybody."
- Four stat cards: **8** In Refinement, **10** In Development, **8** In Review, **3** model providers on one board (Claude, Codex, Gemini). The numbers count up from 0 when the cards scroll into view, one time. With reduced motion, show the final numbers with no count.
- Below the cards: the same board crop with amber rings around three agent tags (see "Technical notes").
- Label the screenshot as "a real Rowbly board" (a caption under the image). Do not say that it is a typical result.

Not in scope:

- The sections with the anchors `#see-it-work` (ROW-49) and `#install` (ROW-51). This Story only links to these anchors. Until those Stories are merged, the buttons go to no target. This is expected.
- New TUI screenshots (ROW-55). Use the existing `assets/screenshot.png`.
- SEO metadata, title and OG image (ROW-54).
- The full accessibility, Lighthouse and page weight check (ROW-56).
- Changes to the shared components of ROW-47, except a small optional prop if one is necessary.

## Acceptance criteria

- [ ] `pnpm --dir website build` passes, and the built `website/dist/client/index.html` has the exact headline, subhead, trust row, proof strip headline and proof strip copy of "Scope", and the text `npm install -g rowbly`. A `grep` examines this. (The copy matches the Spec `website-content-plan`, sections 3.1 and 3.2.)
- [ ] The built `index.html` has a link with `href="#install"` and the text "Get started", a link with `href="#see-it-work"` and the text "See it work", and a link with `href="https://github.com/sgolovine/rowbly"` and the text "Star on GitHub".
- [ ] The built `index.html` has the four stat values (8, 10, 8, 3) with their labels in the static HTML, so that the numbers show without JavaScript.
- [ ] The `alt` text of each board image names the project and the number of agents, for example "A real Rowbly board for a Tic-Tac-Toe project, with 26 AI agents at work on Stories in Refinement, Development and Review." Images that only repeat the board for the animation layers have `alt=""` and `aria-hidden="true"`.
- [ ] All animation CSS of this Story (tag fade-in, ring effect, smooth scroll) is in a `@media (prefers-reduced-motion: no-preference)` block or uses the Tailwind `motion-safe:` variant. The count-up checks `window.matchMedia("(prefers-reduced-motion: reduce)")` and shows the final numbers when it matches. A code review examines this.
- [ ] No file in `website/src/` other than `website/src/styles/app.css` has a hex, `rgb(` or `hsl(` colour, or a Tailwind default palette colour class. A `grep` examines this.
- [ ] `pnpm --dir website typecheck` passes after a build.
- [ ] The root `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build` pass.
- [ ] (A person examines this.) In `pnpm website:dev`, the headline, the subhead and the install command are visible without scrolling at 1280x800 and at 390x844. There is no horizontal scroll from 360 px to 1440 px wide.
- [ ] (A person examines this.) On load, the agent tags of the Hero image fade in one after the other in about 1.5 s. The stat numbers count up when the proof strip scrolls into view. With reduced motion turned on in the browser DevTools (Rendering > Emulate CSS `prefers-reduced-motion: reduce`), all tags and the final numbers show at once, with no motion.

## Technical notes

- **Dependency.** This Story depends on ROW-47 (layout and shared components, PR #243, in review). ROW-47 is not on `main` yet. Start the branch from the current `origin/main`. If ROW-47 is still not merged, merge `origin/story/ROW-47` into this branch first, and tell this in the pull request. The worktree of this Story was made from an older commit; update it before the work.
- **Shared components of ROW-47** (`website/src/components/`): `Section` (props `id`, `eyebrow`, `headline`, `subhead`, `children`, `className`; it renders the headline as `<h2>`), `TerminalFrame` (props `children`, `glow`, `className`), `InstallCommand` (prop `command`, default `npm install -g rowbly`), `AgentTag`, `Kbd`. Use `Button` from `@/components/ui/button` (with `asChild` and an `<a>`) for the two buttons, and `Card` for the stat cards. The Hero needs an `<h1>`, so build the Hero layout itself and do not use `Section` for it. Use `Section` for the proof strip.
- **Files.** Put each section in its own file, so that ROW-49, ROW-50 and ROW-51 can add sections with few merge conflicts:
  - `website/src/components/landing/hero.tsx` (`Hero`)
  - `website/src/components/landing/proof-strip.tsx` (`ProofStrip`)
  - `website/src/components/landing/board-shot.tsx` (the cropped board image with the tag layers and the rings), and `website/src/components/landing/count-up.tsx` (`CountUp`), or other dash-case names.
  - `website/src/routes/index.tsx` renders `<Hero />` and then `<ProofStrip />`. Remove the placeholder wordmark of the scaffold.
- **Theme.** Use only the theme tokens (`bg-brand-background`, `bg-brand-surface`, `border-brand-border`, `text-brand-accent`, `text-brand-text`, `text-brand-muted`, `text-brand-story-key`, and the shadcn/ui mapped classes). Add new keyframes and utilities only to `website/src/styles/app.css`, in a `prefers-reduced-motion: no-preference` block. Ease-out only, no bounce (Spec section 7).
- **Board crop.** `assets/screenshot.png` is 1650x1000 px. It already has its own window title bar, so crop it to the board panel. The board panel is approximately x 262 to 1612 and y 130 to 748 (the Stage tree with the In Refinement, In Development and In Review groups, without the empty area below "Done"). The board background is the flat colour `#282c34`. Make the crop one time with Python Pillow (it is installed) or a similar tool, and commit the results in `website/public/images/`:
  - `board.png`: the crop.
  - `board-no-tags.png`: the same crop with the agent tag column (approximately x 1290 to 1600 of the original, from the first In Refinement row to the last In Review row) filled with `#282c34`.
  Do not commit the script. Write the crop box in the pull request.
- **Tag fade-in.** Show `board-no-tags.png` as the base image. Put 26 absolutely positioned layers of `board.png` on top. Each layer shows one tag row with `clip-path: inset(...)` in percent units, and fades in with an `animation-delay` of about 55 ms times its index (26 tags, about 1.5 s). The tag rows are approximately 19 px high in the original image, from y 186 to 719, with one empty header row between the Stage groups (the rows of the group headers "In Development" and "In Review"). Compute the percent values from the crop box. With reduced motion, the layers have no animation and full opacity. This keeps all colours in the image and out of `website/src/`.
- **Rings in the proof strip.** Show `board.png` with three absolutely positioned amber rings (`ring-2 ring-brand-accent` or a border with the accent token, `rounded-md`) in percent units around three tags, one for each provider and Stage: `claude-19` (In Refinement), `codex-12` (In Development) and `gemini-7` (In Review). An optional slow pulse of the rings is allowed only with `motion-safe:`.
- **Count-up.** The server render shows the final numbers. On the client, when motion is allowed and the cards are not yet in view, set the numbers to 0, and use an `IntersectionObserver` to start a `requestAnimationFrame` count of about 1 s with an ease-out curve, one time. Disconnect the observer after the count. Use `tabular-nums` so that the width does not change. Put the visible number in `aria-hidden="true"` and the final value in a visually hidden text (`sr-only`), so that screen readers read the final number only.
- **Smooth scroll.** Add `html { scroll-behavior: smooth; }` in a `prefers-reduced-motion: no-preference` block in `app.css`, so that the two buttons scroll smoothly.
- **Above the fold.** The Hero is two columns at `lg` and wider (text left, image right), and one column below `lg` (text, then CTAs, then the image). At 390x844, the header of ROW-47 is about 64 px high. Keep the headline at about `text-4xl` on mobile and `text-5xl` to `text-6xl` on desktop, and keep the vertical padding small on mobile, so that the headline, subhead and `InstallCommand` fit in the first 844 px.
- **Image loading.** Give each `<img>` a `width` and a `height` (the crop size), so that no layout shift occurs. The Hero images use `loading="eager"` and `fetchpriority="high"` for the base image. The proof strip image uses `loading="lazy"`.
- **Motion and video.** Do not use video. Do not add an animation library. Use CSS and a small amount of React state.
- **Voice.** Do not use the words in "Do not use on the site" of the Spec (for example daemon, worktree, orchestration).
- No unit tests: the website has no test runner, and the repository rules do not ask for TUI or website tests.

## Assumptions

- The subhead is the copy of Spec section 3.1, which this Story also gives. Spec section 1 has a longer, different subhead. Reason: the Story and the section that it names (3.1) agree, and the acceptance criterion names sections 3.1 and 3.2.
- "Names the project" in the alt text means that the alt text names Rowbly and the Tic-Tac-Toe demo project of the screenshot, and says "26 AI agents". Reason: the screenshot shows the Tic-Tac-Toe project, and both names give the most clear text.
- The fade-in uses two derived images (`board.png`, `board-no-tags.png`) and clipped layers. Reason: the tags are part of the bitmap; this method needs no new colour in `website/src/` and no HTML copy of the tags that can look different from the screenshot.
- The rings go around `claude-19`, `codex-12` and `gemini-7`. Reason: one tag for each of the three providers and the three working Stages supports the stat "3 model providers".
- The "Get started" and "See it work" links go to anchors that ROW-51 and ROW-49 create later. The links are correct now and work when those Stories are merged. Reason: the Story says to use these anchors.
- Use the existing `assets/screenshot.png` (copied by ROW-47 to `website/public/images/screenshot.png`), not the future screenshots of ROW-55. Reason: ROW-55 is not done, and the copy ("Twenty-six agents", 8/10/8) describes this screenshot. If ROW-55 replaces the board image later, the copy and the stats must change together.
- The count-up runs one time, not again on each scroll. Reason: the Spec asks for "one slow loop per section" at most, and a repeated count adds motion with no new information.
