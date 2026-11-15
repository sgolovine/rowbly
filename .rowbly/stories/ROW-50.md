---
title: Build the How it works and Watch everything live landing sections
stage: IN_REFINEMENT
position: 9
worktree: null
pull_request: null
---

## Goal

Build two landing sections: "How it works" in four steps, and "Watch everything live". Together they explain the method and answer "can I trust it?".

## Scope

### How it works
- Headline: **Four steps from idea to pull request.**
- Four numbered cards (a row on desktop, a stack on mobile), each with a small illustration:
  1. **Write a Story.** One line is enough: "Add an undo button for two-player games." It lands in Backlog.
  2. **Tell each Stage what to do.** In plain English. Refinement: "Turn this into a spec with acceptance criteria." Development: "Build it, open a PR, move it to review." Review: "Review the PR." Set it once.
  3. **Start the factory.** Press `f` then `s` (show as `Kbd`). A supervisor picks which Stories get work. Workers take one Story each, on their own branch, in their own conversation.
  4. **Watch, nudge, merge.** Stories move across the board on their own. Read any agent's conversation, interrupt it, or answer when it is blocked. When a PR is ready, you merge it. Close the UI; the factory keeps going.
- A link: "More about how it works" to `/how-it-works`.

### Watch everything live
- Headline: **Never wonder what an agent is doing.**
- Copy: "Every Story shows which agent is on it. Open Threads to read any conversation as it happens. Interrupt it, give it a hint, resume it. When an agent is blocked, it raises its hand and shows up in Attention so you can unblock it and move on."
- Visual: a two-pane mock in `TerminalFrame`. Left: a Story with its agent tag. Right: a Threads conversation that types out line by line, then an Attention banner slides in ("Blocked: needs a design decision").
- Three chips: **Read**, **Interrupt**, **Resume**.
- Make the mock match the real Threads view. Use the screenshots from the Story "Capture real TUI screenshots for the website" when they exist.

## Acceptance criteria

- [ ] The four steps are readable at 360 px.
- [ ] The typing animation stops with reduced motion and shows the full text.
- [ ] Words such as daemon, worktree, lock or Pi do not appear in these sections.
- [ ] The copy matches the Spec `website-content-plan`, sections 3.4, 3.5 and 4.

## Technical notes

Depends on the layout Story.
