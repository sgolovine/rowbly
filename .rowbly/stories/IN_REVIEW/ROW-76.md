---
title: Threads Improvements - Allow user to steer thread.
stage: IN_REVIEW
position: 1
createdAt: 2026-11-16T17:01:49.320Z
updatedAt: 2026-11-16T19:52:46.278Z
worktree: /home/sgolovine/Projects/rowbly-worktrees/ROW-76
pull_request: https://github.com/sgolovine/rowbly/pull/265
---

## Goal

Now a user can only look at a running worker Thread. The factory gives all the instructions to the agent.

Let the user send steering messages to a running worker agent. When the TUI shows a Thread, it shows a text input at the bottom. The user types a message in the input and sends it to the agent. The agent gets the message while it works.

## Scope

In scope:

- A new factory control command, `steer`, with the text of the message. The live daemon gives the text to the Pi session of the active worker.
- A service function that sends the command and waits for the receipt, as `cancel` and `resume` do.
- A CLI command, `rowbly thread steer <id> --message <text>`, for parity with `thread cancel` and `thread resume`.
- A steering input at the bottom of the Thread in the Threads tab of a Story (`thread-panel`) and in the Thread of the Factory view (`thread-pane`).
- Tests for the service, the control command and the manager. Updates to the documentation.

Not in scope:

- Steering of the supervisor Thread.
- Messages to a Thread that is not running (pending, completed, failed, cancelled or interrupted). Use resume for these.
- Attachments or images in a steering message.
- A queue of messages while the factory is stopped.

## Acceptance criteria

- [ ] `FactoryCommandType` includes `steer`, and `FactoryCommand` has an optional `message` field. `processCommands` rejects a `steer` command with no message, an empty message (after trim) or a message longer than 4000 characters. A unit test in `factory-control.test.ts` examines each case.
- [ ] The command file size limit lets a `steer` command with a 4000-character message (also with multibyte characters) pass. A unit test examines this.
- [ ] The manager has `steerWorker(threadId, expectedRunId, message)`. It rejects the command with `ConflictError` when the run ID or the owner token is different, when the Thread is not in the `active` map, when the Thread status is not `running`, or when the worker has no Pi session. A unit test examines each case.
- [ ] For a valid command, `steerWorker` calls `session.steer(<text>)` on the Pi session of the worker. `<text>` is built by a function in `src/services/messages/messages.ts`. A unit test with a fake session examines the call and the text.
- [ ] When the Pi session is not streaming, `steerWorker` rejects the command with the message `Worker is not working now`, and it does not start a new prompt. A unit test examines this.
- [ ] `sendFactoryCommand("steer", { threadId, message })` (or a `steerThread` wrapper in `src/services/factory/factory.ts`) publishes the command and resolves on the `completed` receipt. It gives `ConflictError` with the rejection message on a `rejected` receipt, and `ConflictError("Factory is not running")` when no live daemon exists. A unit test examines each case.
- [ ] `rowbly thread steer <id> --message <text> --json` prints the receipt and exits with 0 on success. A missing `--message` is a Commander error. An invalid message gives `VALIDATION` and exit code 1.
- [ ] In the Threads tab of a Story and in the Thread pane of the Factory view, a running Thread shows a one-line text input under the conversation, with the placeholder `Send a message to the agent`. A Thread that is not running does not show the input. (A person examines this in a real terminal. See the `rowbly-screenshots` skill.)
- [ ] In the thread region, `m` (or a click on the input) focuses the input. `enter` sends the message, clears the input and shows an `info` toast `Sent message to <story> <thread>`. `esc` leaves the input and keeps the text. An error shows an error toast and keeps the text. While the input has the focus, the other keys of the thread region (`x`, `r`, `tab`, conversation scroll keys) do not act. (A person examines this.)
- [ ] When the session history has the steering message, Peek shows it as a user message in the conversation. (A person examines this.)
- [ ] `docs/architecture/native-factory/controls.md`, `docs/architecture/native-factory/recovery.md` (if it lists the control commands), `docs/architecture/tui.md` and `skills/rowbly-reference.md` (and its copies in `skills/<name>/references/`) describe the new command and the keys, in STE.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build` pass.

## Technical notes

- Control commands: `src/services/factory-control/factory-control.ts`. Add `steer` to `FactoryCommandType` and `COMMAND_TYPES`, add `message?: string`, and validate it in `acceptedCommand` (as `dismiss` validates `attentionKey`). `loadCommand` and `readPrunable` reject files larger than 4096 bytes. Raise this limit to 32768 bytes so that a 4000-character message fits after JSON escaping.
- Daemon dispatch: `src/commands/factory-runner/control-poller.ts`. Add `steerWorker` to `ControlTarget` and call it for `steer`. It needs `threadId` and `expectedRunId`, as `cancel` does.
- Manager: `src/services/factory-manager/factory-manager.ts` exposes the function. Put the logic next to `cancelWorker` in `worker-reservation.ts` (or a new `worker-steer.ts`). Use `serial(manager, ...)` for the checks, as `cancelWorker` does. Call `session.steer()` outside `serial`. `getState(manager).active.get(id)?.session` is the `PiSession`; `handle.session` is the Pi `AgentSession`, which has `steer(text)` and `isStreaming`.
- The Pi SDK stays behind the lazy boundary in `src/services/pi-runtime/`. The manager already holds the session object. Do not import the Pi SDK in the CLI or TUI paths.
- Message text: add a function in `src/services/messages/messages.ts`, for example `steeringMessage(text)`, that gives a short header that tells the agent that the text is a steering message from the user, then the user text. AGENTS.md says that this module is the only place that builds the messages of the factory agents.
- Service: `src/services/factory/factory.ts` `sendFactoryCommand` passes the `message` to `publishCommand`. Validate the message (trim, 1 to 4000 characters) in the service before it publishes, and throw `ValidationError`.
- CLI: `src/commands/thread/thread.ts`. Add `steer <id>` with a mandatory `--message <text>` option.
- TUI: `src/tui/screens/stories/thread-panel/thread-panel.tsx`, `src/tui/screens/stories/threads-tab/` (keys in `threads-tab-actions.ts`), `src/tui/screens/threads/thread-pane/`. Put the input in one shared component (for example `src/tui/screens/stories/thread-steer-input/`) that uses `TextInput` from `src/tui/components/`. Read the `rowbly-tui-design` skill first. Use only `theme` colours. Send through `runExclusive` and the toast pattern of `sendCommand` in `threads-tab-actions.ts`.
- `docs/architecture/native-factory/controls.md` says that the Factory view Thread is read-only. Change this text: it is read-only except for the steering input.
- Do not write TUI tests (AGENTS.md rule 4).

## Assumptions

- The message goes to the agent with Pi `steer()` (delivered after the current tool call), not `followUp()`. Reason: the author asks to "steer" the agent while it works.
- Only a `running` worker Thread with a live session accepts a message. When the session is not streaming, the command is rejected and no new prompt starts. Reason: a new prompt outside the worker flow of `worker-launch.ts` can break the result collection. This is the smallest safe scope.
- The supervisor Thread is not in scope. Reason: the author writes about "a running thread" of the factory work, and the supervisor has its own digest flow.
- The maximum message length is 4000 characters, and the command file limit goes from 4096 to 32768 bytes. Reason: the current 4096-byte limit cannot hold a useful message after JSON escaping.
- The steering message has a header from `messages.ts`. Reason: the system prompt tells the agent that no person is available, so the agent must know that the text comes from the user.
- The input shows in both the Threads tab and the Factory view Thread pane. Reason: the author writes "when showing the thread", and both views show a Thread with `ConversationView`.
- The key that focuses the input is `m`. Reason: `x`, `r`, `f`, `j`, `k` and `tab` already have a function in the thread region.
- A CLI command is in scope. Reason: AGENTS.md says that the CLI and the TUI call the same services, and `cancel` and `resume` have CLI commands.

## Review findings

The Changelog Stage could not merge `origin/main` into `story/ROW-76` (PR #265). These files have merge conflicts with `main`:

- `docs/architecture/tui.md`
- `src/tui/screens/stories/threads-tab/threads-tab-actions.ts`
- `src/tui/screens/stories/threads-tab/threads-tab-view.ts`
- `src/tui/screens/stories/threads-tab/threads-tab.tsx`
- `src/tui/screens/stories/threads-tab/use-threads-tab.ts`
- `src/tui/screens/threads/thread-pane/thread-pane.tsx`
- `src/tui/screens/threads/thread-pane/use-thread-pane.ts`

Merge `origin/main` into the branch, repair these conflicts (`main` added the full-screen conversation in `src/tui/components/`), run the checks and push. The merge was aborted. No changelog entry was written.
