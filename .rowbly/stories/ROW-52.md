---
title: Build the How it works page
stage: IN_DEVELOPMENT
position: 1
worktree: /home/sgolovine/Projects/rowbly-worktrees/ROW-52
pull_request: null
---

## Goal

Build the `/how-it-works` page of the Rowbly website: a longer, calm explanation for visitors who want the mental model before they install. Today the route `website/src/routes/how-it-works.tsx` shows only a "This page is not ready yet" placeholder. After this Story, the page explains the board, the Stage prompts, the factory, the controls, the models and the files, and sends the visitor to `/install`.

## Scope

In scope. Sections, in this order. Write the copy from Spec `website-content-plan` (section 5 for the key lines, section 3 and section 4 for the facts and the voice):

1. **Intro** (page `h1`): "Rowbly turns a Kanban board into a production line. Each column is a Stage. Each Stage has a prompt. Agents do what the prompt says."
2. **The board:** Stories, Stages, Story keys such as `ROW-42`. Specs and attachments are optional context.
3. **Stage prompts:** three example prompts as cards. Use the prompts of Spec section 4, step 2: In Refinement "Turn this into a spec with acceptance criteria.", In Development "Build it, open a PR, move it to review.", In Review "Review the PR." Say that users can add their own Stages. Key line: "A Stage prompt is the whole job description. Change the prompt and every agent that enters that Stage changes with it."
4. **The factory:** one paragraph on the supervisor and the workers. Key line: "The supervisor does not write code. It reads the board, decides what is ready, and hands Stories to workers. Workers do the work." One Story, one branch and one conversation for each worker. A worker limit. The factory keeps running after you close the UI.
5. **Staying in control:** Threads (read, interrupt, resume), Attention items, the agent tag on each Story. Key line: "Interrupting an agent is not an emergency stop. It is a conversation. Say what you want, and resume."
6. **Your models:** sign in to providers, pick a supervisor model and a worker model, set the worker limit.
7. **Files in your repo:** `.rowbly/` folder, Markdown and JSON, diffable, commit it, no account.
8. **Call to action:** a link or button to `/install` (TanStack Router `Link`).
9. A page title and a meta description in the `head` of the route.

Reuse the existing website components where they help: `Section`, `TerminalFrame`, `AgentTag`, `Kbd`, `InstallCommand`, `ui/card`, `ui/button`, and the landing `AnimatedBoard` (for example, in "The board").

Not in scope:

- Canonical URLs, Open Graph tags, JSON-LD and the sitemap (ROW-54).
- The `/install` page (ROW-53).
- Changes to the landing page sections (ROW-48 to ROW-51).
- New screenshots of the TUI (ROW-55).
- New npm dependencies.

## Acceptance criteria

- [ ] `website/src/routes/how-it-works.tsx` no longer shows the "This page is not ready yet" placeholder. It shows sections 1 to 8 of Scope in that order.
- [ ] The page has exactly one `h1` (the intro). Each other section has a heading (`h2`, through `Section`).
- [ ] The three key lines of Spec section 5 occur on the page word for word.
- [ ] The "Stage prompts" section shows three prompt cards and says that users can add their own Stages.
- [ ] The page has a link to `/install`.
- [ ] The route `head` sets the title `How it works | Rowbly` and a `description` meta tag.
- [ ] `pnpm --dir website build` succeeds and writes `website/dist/client/how-it-works/index.html`. That file contains the page copy (the page is prerendered, so a deep link to `https://rowbly.com/how-it-works` loads it directly).
- [ ] A case-insensitive whole-word search (for example `grep -iwE`) of `website/src/routes/how-it-works.tsx` and of each new component file finds none of these words: daemon, worktree, lock, flock, Pi SDK, runtime, state file, harness, orchestration, JSON schema.
- [ ] Each claim is true for the current Rowbly version. A person checks the copy against `README.md` and the facts in Technical notes.
- [ ] All motion respects `prefers-reduced-motion`. A person checks this with the reduced-motion setting on.
- [ ] Root `pnpm lint` and `pnpm --dir website typecheck` pass.

## Technical notes

- Base the branch on `origin/main`. The ROW-50 landing components (`website/src/components/landing/how-it-works.tsx`, `watch-live.tsx`) are on `origin/main`. The worktree checkout of this Story can be behind it.
- Route: `website/src/routes/how-it-works.tsx` (TanStack Start file route `createFileRoute("/how-it-works")`). Add a `head: () => ({ meta: [{ title: ... }, { name: "description", content: ... }] })`, as `website/src/routes/404.tsx` does.
- Put new page components in `website/src/components/how-it-works/` (dash-case file names). Keep the route file thin.
- Prerender: `website/vite.config.ts` has `prerender.crawlLinks: true`, and the header links to `/how-it-works`, so the build writes the page. If the build does not write `how-it-works/index.html`, add `{ path: "/how-it-works" }` to `pages`.
- Colours and fonts: only the brand Tailwind tokens in `website/src/styles/app.css` (`brand-background`, `brand-surface`, `brand-border`, `brand-accent`, `brand-text`, `brand-muted`, `brand-story-key`). Mono font for Story keys, keys, commands and agent tags. Amber accent only for "live" things.
- Motion: CSS or SVG only, one slow loop for each section at most, no video. Follow the existing `AnimatedBoard` for reduced motion.
- Facts to use (from `README.md` and `src/`):
  - Each Stage can have a prompt in `.rowbly/stages/<KEY>.md`. A Stage whose prompt gives an agent work gets workers. Backlog and Done get no work.
  - The supervisor only selects Stories and starts or stops workers (`src/config/prompts/SUPERVISOR.md`). It does not write code.
  - Each worker has one Story, its own branch and its own conversation (README "Rowbly" intro).
  - The worker limit is four when it is not set. Set it in Settings > AI > Limits or with `rowbly factory configure --max-workers`.
  - Start the factory with `f` then `s`. Close the TUI and the factory stays active.
  - Threads: press `t` to see the Threads. Open a Thread to read its conversation. `x` interrupts (with confirmation). `r` resumes an eligible Thread. The board shows the agent next to each Story that has an active worker. Factory controls show Attention items.
  - Providers: sign in from Settings > AI > Providers or `rowbly auth login`. The supervisor model and the worker model are separate.
  - The board is Markdown and JSON in `.rowbly/`. No account.
- Voice: Spec section 6. Do not use the forbidden words of Spec section 6 in the copy.
- Do not write tests for the website. Checks: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` at the root, and `pnpm --dir website build` and `pnpm --dir website typecheck`.
- Depends on ROW-47 (layout, done) and ROW-49/ROW-50 (landing components, done).

## Assumptions

- The three example Stage prompts are the prompts of Spec section 4, step 2. Reason: the Story does not give them, and the Spec already uses them on the landing page.
- "Say what you want, and resume" stays as the key line. The supporting copy says that you change the Story or its Stage prompt, then resume the Thread. Reason: `thread resume` and the `r` key take no message. A material Story change releases an interrupted Story (README "Stop, resume and recovery"), so the copy stays true.
- The intro says "Each Stage has a prompt" as the Story gives it. Reason: it is the author's copy and the default Stages all have prompts.
- The page title is `How it works | Rowbly`. Reason: it follows the `Page not found | Rowbly` pattern of the 404 route. ROW-54 can change it.
- Mention "The factory runs on Linux today" in "The factory" section. Reason: Spec section 6 asks to be honest about edges, and the README requires Linux for the factory.
- Do not use the components of ROW-51 (in development). Reason: they are not on `origin/main`. Build a simple `.rowbly/` file tree in this Story if one is needed.
