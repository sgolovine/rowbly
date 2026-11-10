---
title: Replace story agent locks with factory state activity
stage: BACKLOG
worktree: null
pull_request: null
---

## Goal

Use `.rowbly/state.json` as the source for agent activity in the UI. Remove `agentLock` from Story frontmatter and runtime behavior.

## Scope

1. Remove the Story agent lock type, parsing, writes, validation, and stage-change logic.
2. Remove the `story lock` and `story unlock` commands and their documentation.
3. Update factory scripts, bundled skills, installed project skills, and stage prompts that use agent locks.
4. Remove existing `agentLock` keys through a documented migration or repair command. Preserve other frontmatter and Story descriptions.
5. Replace the Story row agent indicator with activity from the current Project's `.rowbly/state.json`.
6. Put state file reads, validation, and activity selection in a shared service. Keep the UI as a thin front end.
7. Keep factory duplicate-assignment checks based on state records and harness workers. Document the limits across separate checkouts.

## Activity rules

- Match each attempt to the Story ID and current Stage. Ignore records for deleted Stories and other Stages.
- Show current `preparing` and `running` attempts as active. Use the worker identity available in the state schema.
- Do not show `completed`, `failed`, `blocked`, or `interrupted` attempts as active agents.
- Define a deterministic rule for repeated attempts. A later terminal attempt must not expose an earlier attempt as active.
- Show conflicting current attempts as uncertain activity. Do not choose an arbitrary agent or claim exclusive ownership.
- Do not treat file age alone as proof that a worker stopped. The UI must distinguish recorded activity from confirmed worker liveness.

## State file edge cases

- Missing file: keep the Project usable and hide the active-agent indicator. Show a neutral explanation that factory activity data is unavailable.
- Unreadable file: keep the Project usable. Show an activity-unavailable warning with the path and a useful error message.
- Valid empty state: show no recorded active agent. Do not show an error.
- Incomplete state: distinguish absent optional display fields from absent mandatory schema fields.
- If only an optional agent label is absent, show the worker ID or a neutral worker label.
- If mandatory fields are absent, show activity as incomplete or unknown. Do not report that no agent works on the Story.
- Corrupted JSON, conflict markers, invalid field types, unknown statuses, and unsupported schema versions: show an activity-unavailable warning.
- Do not silently convert invalid state into an empty assignment list. Do not present partial invalid data as a complete activity record.
- If a previously valid file becomes unreadable or invalid, remove its active indicators or mark them explicitly as stale.
- Do not retain an unqualified active-agent indicator from the last successful read.
- Recover automatically when the file becomes valid again. Handle file creation, deletion, atomic replacement, and Project switches.
- Keep warnings visible without repeated toasts on each refresh. All Story actions must remain usable.
- Never create, repair, truncate, or overwrite `state.json` from the UI. Keep it outside Git commits.

## Acceptance criteria

1. Story frontmatter no longer contains agent locks after the supported cleanup operation.
2. CLI, services, UI, doctor, skills, and prompts no longer depend on `agentLock`.
3. The UI shows the correct recorded worker activity from the current Project state file.
4. The UI distinguishes missing data, valid empty data, incomplete data, and corrupted data as specified above.
5. A state file failure does not prevent Project access or Story actions.
6. State updates and recovery refresh the UI without a restart or repeated warnings.
7. Tests cover all state file edge cases, repeated attempts, conflicting attempts, Stage changes, and Project switches.
8. Tests prove that failed reads do not change state files or retain misleading active indicators.
9. Run the repository checks and factory script tests. Inspect the changed TUI in a real terminal through agentic-tui.
