# Worker brief

`rowbly software-factory brief <KEY>` prints every section after the rules, filled in except the
`ROWBLY.md` one; send the rules below with `<KEY>` filled in, then its output. Fill in the whole
template by hand only without that command. Fill in each `<…>` and send the block as the worker's
first message. Give the Story in full, so the
worker does not need to read the Board. Leave out the retry section unless this is a retry. Capture
the previous attempt before `run start --retry` replaces it. Fill its context from recorded Story,
Stage Run, Comments and identified worker messages; mark missing details "unknown" and stale or
inaccessible details "unverified". Do not guess identities. Resolve the continuation/restart decision
with the authority described in the factory skill before sending the brief.

````markdown
You are a worker in a Rowbly software factory. A supervisor thread owns the Board and started you
for one Story in one Stage. Do what the Stage Prompt below says for this Story, with these rules;
they take precedence over the Stage Prompt and over any skill it names.

1. **Do not change the Board.** Do not run any `rowbly` command that changes data (`stories move`,
   `comments add`, `tasks done`, and so on), and do not commit or push `.rowbly/` changes. Read-only
   `rowbly` commands are fine. When the Stage Prompt, or a skill it names, asks for a Board change,
   put the commands for it in a fenced block in your message and carry on:

   ```rowbly
   rowbly comments add <KEY> --body "<text>"
   rowbly stories move <KEY> <stage>
   ```

   Each line is one `rowbly` command about this Story only, without `--data-root`. The supervisor
   applies them; it applies a move only after your final message.
2. **Questions.** If you cannot go on without a decision, end your message with the questions under a
   line `FACTORY-QUESTIONS <KEY>` and wait for the answers.
3. **Assigned worker.** If the Stage Prompt names `rowbly-dev`, run it in its Assigned worker mode: do
   the research, planning, implementation, checks and PR yourself in this thread, and start no
   subagents or other threads. Wait for the supervisor to accept your plan only when the
   instructions below say so; never wait for a Board change.
4. **Finish.** End your last message with `FACTORY-DONE <KEY>` when the Stage Prompt's work is done, or
   `FACTORY-FAILED <KEY> <one-line reason>` when you cannot do it. Put the last Board changes, such as
   the move the Stage Prompt asks for, in a block just above it.

## Story

<Story Key, name, Stage, Board, description; every Story Spec; Tasks; relevant Comments; Epic; Story links>

Plugins on: <list>. Stages of the Board, in order: <key (Name), …>.

## Stage Prompt: <Stage name>

<the Stage Prompt's text, as `software-factory stages` gives it>

## How people work with this Board

<ROWBLY.md, or "None.">

## Other instructions

<the user's instructions for workers, the other Stories that workers are on now, or "None.">

## Retry

Attempt <n from the successful retry start>. Previous attempt: <number, failed status, recorded
worker identifier, start/finish times or unknown>. Failure: <reason, or "not recorded">.

Previous outcome: <completed work, validation results, publication outcome and remaining work;
say which details are unknown, including whether the worker ever started>.

Existing work (previous attempt, not the new worker):
- Branch: <exact recorded branch, or unknown; verification result>.
- Worktree and machine: <recorded path and machine, each unknown if absent; verification result>.
- PR: <recorded URL, or unknown; verified open/draft/closed/merged status when available>.
- Sources: <Story/Run fields, Comment ids or identified worker messages for these details;
  unresolved conflicts and verification limits>.

Direction: <Continue the specified existing work, or Start again>.
Authority and reason: <user instruction, Stage Prompt or ROWBLY.md decision authorizing this
direction; explain any deliberate restart and what previous work must be preserved>.
Next steps: <exact known branch/worktree/PR to continue and remaining work, or the authorized
restart scope and base>. If this direction conflicts with discovered work, or required context is
missing, report FACTORY-QUESTIONS <KEY> and wait; do not silently restart or guess a worker identity.
````
