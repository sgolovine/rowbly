---
title: Build the How it works page
stage: IN_REFINEMENT
position: 11
worktree: null
pull_request: null
---

## Goal

Build the `/how-it-works` page: a longer, calm explanation for visitors who want the mental model before they install.

## Scope

Sections, in order:

1. Intro: "Rowbly turns a Kanban board into a production line. Each column is a Stage. Each Stage has a prompt. Agents do what the prompt says."
2. **The board:** Stories, Stages, keys such as ROW-42; Specs and attachments as optional context.
3. **Stage prompts:** three example prompts as cards. Say that users can add their own Stages. Key line: "A Stage prompt is the whole job description. Change the prompt and every agent that enters that Stage changes with it."
4. **The factory:** one paragraph on the supervisor and the workers. "The supervisor does not write code. It reads the board, decides what is ready, and hands Stories to workers. Workers do the work." One Story, one branch, one conversation for each worker. A worker limit. It keeps running after you close the UI.
5. **Staying in control:** Threads (read, interrupt, resume), Attention items, the agent tag on each Story. Key line: "Interrupting an agent is not an emergency stop. It is a conversation. Say what you want, and resume."
6. **Your models:** providers, a supervisor model and a worker model, the worker limit.
7. **Files in your repo:** `.rowbly/`, diffable, no account.
8. Call to action to `/install`.

Reuse the landing components (animated board, `AgentTag`, `TerminalFrame`) where they help. Add a page title and description.

## Acceptance criteria

- [ ] The page is at `https://rowbly.com/how-it-works` and loads directly from a deep link.
- [ ] No internal terms (daemon, worktree, lock, flock, Pi SDK, runtime, state file) appear.
- [ ] Every claim is true for the current Rowbly version (check against `README.md`).
- [ ] The copy matches the Spec `website-content-plan`, section 5.

## Technical notes

Depends on the layout Story.
