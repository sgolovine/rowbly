---
title: Website content plan
stories:
  - ROW-45
  - ROW-46
  - ROW-47
  - ROW-48
  - ROW-49
  - ROW-50
  - ROW-51
  - ROW-52
  - ROW-53
  - ROW-54
  - ROW-55
  - ROW-56
  - ROW-57
  - ROW-58
---

# Rowbly website: content plan

This plan is the source of the copy and the design of the Rowbly marketing website. Fable 5.1 drafted it from the README, the brand assets and the screenshot in `assets/`. The site is for consumers: it sells what Rowbly does and how it feels to use. It does not explain internals.

Stack: TanStack Start (static prerender), Tailwind CSS, shadcn/ui, GitHub Pages with the custom domain `https://rowbly.com` (base path `/`).

## Stories and order

1. ROW-58 Lint rules that accept TanStack Router file names
2. ROW-45 Scaffold (blocks all other website Stories)
3. ROW-46 GitHub Pages deploy · ROW-47 Layout and shared components · ROW-55 Real TUI screenshots (can run in parallel)
4. ROW-48 Hero and proof strip · ROW-49 Animated board · ROW-50 How it works and Watch live · ROW-51 Closing sections
5. ROW-52 How it works page · ROW-53 Install page · ROW-54 SEO and OG image
6. ROW-56 Accessibility and performance check
7. ROW-57 Link the site from the README and package

## 1. Positioning

- **Value proposition:** Rowbly is a software factory manager. Put Stories on a board, tell each Stage what to do, and a team of AI agents builds them while you watch.
- **Headline (chosen):** Your backlog, built by a factory of agents.
  - Other options: "Write the Story. The factory ships it." (overstates: people merge PRs). "Twenty-six agents. One board. Your repo." (used as the proof strip instead).
- **Subhead:** Rowbly is a software factory manager that lives in your terminal. Keep a Kanban board of Stories inside your Git repo, give each Stage a plain-English prompt, and press one key. A supervisor and a team of AI workers refine, build, open PRs and review, in parallel, while you watch every conversation live.
- **Primary CTA:** `npm install -g rowbly` copy block and **Get started**. **Secondary:** **See it work**. **Tertiary:** Star on GitHub.

## 2. Sitemap

| Page | Path | Why |
| --- | --- | --- |
| Home | `/` | The full pitch: what, how much, how it works, install. |
| How it works | `/how-it-works` | A calm, longer mental model for visitors who want it before they install. |
| Install | `/install` | Requirements, first commands, sign-in. Honest about Linux and costs. Links to the README. |

Not now: pricing (free), blog, docs (the README has them), changelog (later, from GitHub releases).
Footer on every page: GitHub, npm, README, MIT License.

## 3. Landing page sections

### 3.1 Hero
- Headline: Your backlog, built by a factory of agents.
- Copy: Rowbly is a software factory manager that lives in your terminal. Put Stories on a board. Tell each Stage what to do. Start the factory, and a team of AI agents refines, builds, opens PRs and reviews, all at once, while you watch.
- Visual: the real screenshot in a terminal frame with an amber glow; agent tags fade in one by one. Trust row: Free. Open source. MIT. Bring your own models.

### 3.2 Proof strip
- Headline: One board. Twenty-six agents. All at the same time.
- Copy: This is a real Rowbly board. Eight Stories being refined, ten being built, eight under review, each one with its own agent and its own branch. Nobody is waiting on anybody.
- Stats: 8 In Refinement, 10 In Development, 8 In Review, 3 model providers (Claude, Codex, Gemini). Count up on scroll.

### 3.3 Stories move themselves (`#see-it-work`)
- Copy: You write a Story in a sentence. The factory picks it up, refines it into a spec, builds it on its own branch, opens a PR and moves it to review. You read the PR and press merge.
- Visual: a five-column animated board. Cards move right; agent tags appear in working Stages. Column headers show the Stage prompt in a tooltip.

### 3.4 How it works
- Headline: Four steps from idea to pull request. See section 4.

### 3.5 Watch everything live
- Headline: Never wonder what an agent is doing.
- Copy: Every Story shows which agent is on it. Open Threads to read any conversation as it happens. Interrupt it, give it a hint, resume it. When an agent is blocked, it raises its hand and shows up in Attention so you can unblock it and move on.
- Visual: Story plus a typing Threads conversation; an Attention banner slides in. Chips: Read, Interrupt, Resume.

### 3.6 Bring your own models
- Headline: Your models. Your limits. Your keys.
- Copy: Sign in to Anthropic, OpenAI, Google Gemini and more. Pick one model to supervise and another to do the work. Set how many workers run at once. Change your mind any time.

### 3.7 It lives in your repo
- Headline: The board is just files in your repo.
- Copy: Your Stories, Stages and Specs are Markdown and JSON in a `.rowbly/` folder. Commit them. Diff them. Branch them. Clone the repo and the board comes with it. No account, no sync, no vendor between you and your work.

### 3.8 Humans and scripts
- Headline: A terminal UI when you want to look. A CLI when you want to script.
- Copy: Open `rowbly` and work the board with your keyboard. Or drive it from the command line: `rowbly story create`, `rowbly factory status`. Your own scripts and agents can use the same commands.

### 3.9 Specs and attachments
- Headline: Context that travels with the Story.
- Copy: Link a Markdown Spec to a Story so agents build what you meant. Paste a screenshot straight onto a Story. Everything stays next to the code.

### 3.10 Install (`#install`)
- Headline: Start your factory in two minutes.
- Commands: `npm install -g rowbly`, `cd your-repo`, `rowbly`.
- Copy: Onboarding sets up your Stages and prompts. Sign in to a provider, press `f` then `s`, and watch the board move. Free and open source under MIT. Needs Node 22 or later. The factory runs on Linux today.

## 4. How it works in four steps

1. **Write a Story.** One line is enough: "Add an undo button for two-player games." It lands in Backlog.
2. **Tell each Stage what to do.** In plain English. Refinement: "Turn this into a spec with acceptance criteria." Development: "Build it, open a PR, move it to review." Review: "Review the PR." Set it once.
3. **Start the factory.** Press `f` then `s`. A supervisor picks which Stories get work. Workers take one Story each, on their own branch, in their own conversation, up to as many as you allow.
4. **Watch, nudge, merge.** Stories move across the board on their own. Read any agent's conversation, interrupt it, or answer when it is blocked. When a PR is ready, you merge it. Close the UI; the factory keeps going.

## 5. Supporting pages

### /how-it-works
Intro, The board, Stage prompts, The factory, Staying in control, Your models, Files in your repo, CTA. Key lines:
- A Stage prompt is the whole job description. Change the prompt and every agent that enters that Stage changes with it.
- The supervisor does not write code. It reads the board, decides what is ready, and hands Stories to workers. Workers do the work.
- Interrupting an agent is not an emergency stop. It is a conversation. Say what you want, and resume.

### /install
Requirements, Install, First run, Sign in to a provider, Start the factory, Costs, link to the README. Key lines:
- You can use the board on any platform. The factory itself runs on Linux today.
- Rowbly is free. Your model provider bills you for the models you use.

## 6. Voice and tone

- Plain and confident. Short sentences. No "revolutionary" or "supercharge".
- Show the scale, do not shout it. Numbers from a real board beat adjectives.
- The human stays in charge. Each mention of autonomy pairs with visibility or control (watch, interrupt, merge).
- Terminal-native, not terminal-nerdy. Keys and commands look like keycaps and code; sentences read like a product.
- Honest about edges: "Linux for the factory today", "you merge the PR".

**Use:** Story, Stage, board, Spec, factory, supervisor, worker, agent, prompt, PR, branch, Threads, Attention, lives in your repo, bring your own models.
**Do not use on the site:** daemon, worktree, lock, flock, Pi SDK, runtime, JSON schema, state file, harness, orchestration, "autonomous software engineer", "replaces developers", "ships features".

## 7. Visual direction

- **Palette:** background `#111214`, surface `#17181B`, border `#26282D`, accent amber `#F5B841` (means "live"; use sparingly), text `#ECEAE4`, muted `#9A9CA3`, Story-key blue from the screenshot. No other hues.
- **Type:** JetBrains Mono for the `rowbly_` wordmark, code, keys, Story keys and agent tags. Inter or Geist for body and headings.
- **Motion:** motion means work is happening (cards move, cursors blink, numbers count, text types). One slow loop per section, ease-out, no bounce. All motion respects `prefers-reduced-motion`. CSS/SVG only; no video.
- **Images:** hero screenshot (exists); animated board; Threads mock; AI settings mock; TUI/CLI split; `.rowbly/` file tree; four step illustrations; OG image; icons at 16, 32, 180 and 512 px.

## 8. SEO

- Title: Rowbly: a software factory manager in your terminal
- Description: Keep a Kanban board of Stories in your Git repo. Give each Stage a prompt. Start the factory and a team of AI agents refines, builds and reviews in parallel.
- OG image 1200x630: wordmark and headline on the left, board crop on the right, amber line at the bottom.
- `SoftwareApplication` JSON-LD. Canonical URLs on `https://rowbly.com`.

## 9. Open questions for the owner

Decided: the site uses the custom domain `https://rowbly.com`.

1. Provider logos or plain names? Logos can need brand approval.
2. Show a version badge? It is honest but signals an early product.
3. "26 agents" comes from one demo run. The site calls it "a real Rowbly board", not a typical result.
