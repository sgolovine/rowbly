---
title: Store factory state in .rowbly/state.json
stage: IN_DEVELOPMENT
position: 2
worktree: null
pull_request: null
---

## Goal

The factory supervisor keeps its worker records and scan state in a temporary directory (`workers.json`, `stages.json`). A restart or a new session loses them, so the supervisor can lose track of active workers and earlier attempt results.
Store this state in one file for each Project, `<root>/.rowbly/state.json`, and keep the file out of Git. Then a supervisor can stop and start again without duplicate assignment.

## Scope

In scope:

- A new helper script `skills/factory/scripts/factory-state.mjs` that reads, validates and writes `<root>/.rowbly/state.json` atomically.
- Changes to `skills/factory/SKILL.md` so that the supervisor uses the state file and the helper for all persistent state ("Scan the Stories", "Assign workers", "Stop the factory").
- The same changes in the installed copies `.claude/skills/factory/` and `.agents/skills/factory/` (tracked files; copy them so they stay identical to `skills/factory/`).
- `node:test` tests for the helper, and the `test:factory` script in `package.json`.
- Entries in the repository `.gitignore` for the state file and its temporary write file.

Not in scope:

- Migration of an earlier temporary state (for example `/tmp/rowbly-factory.*/workers.json`). Decision of the user: ignore it. A new supervisor starts from `.rowbly/state.json` only.
- Changes to the `rowbly` CLI, to the services in `src/`, to `rowbly init` or to `rowbly doctor`. The CLI does not read the state file.
- Changes to the `.gitignore` of other Projects. The factory skill only warns (see the checklist item below).
- A lock between two supervisors. The skill keeps the statement that Rowbly locks do not give mutual exclusion.
- Changes to the event format of `watch-stages.mjs`. The scanner stays responsible for Story events. The supervisor stays responsible for worker assignment and for the state file.

## State format

`<root>/.rowbly/state.json`, version 1:

```json
{
  "version": 1,
  "updatedAt": "2026-11-10T12:00:00.000Z",
  "scan": {
    "stages": { "ROW-01": "DONE", "ROW-08": "IN_REFINEMENT" }
  },
  "attempts": [
    {
      "story": "ROW-08",
      "stage": "IN_REFINEMENT",
      "workerId": "mcp:1b588a77-…",
      "workerType": "thread",
      "model": "claude-opus-5-5",
      "status": "running",
      "result": null,
      "startedAt": "2026-11-10T12:00:00.000Z",
      "stoppedAt": null,
      "reported": false
    }
  ]
}
```

- `scan.stages`: the Stage of each Story at the last scan. The supervisor uses it to see that a Story left a Stage, and then clears the earlier attempt for that stay.
- `attempts`: one record for each worker. `status` is one of `preparing`, `running`, `completed`, `failed`, `blocked`, `interrupted`. An attempt with `preparing` or `running` is active. `result` is the short result text of the worker, or `null`.
- `workerType` is `thread` or `subagent`. Other keys in a record are allowed and are kept (for example `options` or `retryAuthorization`).

## Helper script

`node <skill directory>/scripts/factory-state.mjs <command> --root <root>`:

- `read`: prints the state as JSON on stdout. If the file does not exist, prints an empty version 1 state (`scan.stages` empty, `attempts` empty) and exits 0. It does not create the file.
- `write`: reads a full state document from stdin, validates it, sets `updatedAt` and replaces the file atomically. It writes `.rowbly/state.json.tmp-<pid>` in the same directory, flushes it, then renames it over `state.json`. If a step fails, it deletes the temporary file and leaves the earlier `state.json` unchanged.
- Validation: the document is a JSON object, `version` is `1`, `scan.stages` is an object of strings, `attempts` is a list, and each attempt has a string `story`, `stage` and `workerId`, and a `status` from the list above.
- Errors: exit code 1 and one JSON line on stderr, `{"error": {"message", "path", "hint"}}`. For a malformed file, `path` is the absolute path of `state.json`, and `hint` tells the user to repair the JSON, or to check the harness for active workers and then move the file away. The helper never overwrites or deletes a malformed file.
- If `<root>/.rowbly/` does not exist, `read` and `write` fail with an error that gives the path.

## Factory skill changes

- "Scan the Stories" step 1: read the state with `factory-state.mjs read`. Do not make a temporary directory. A Project without a state file starts with the empty state.
- If `read` fails, tell the user the path and the hint, and stop the factory before any assignment. Do not start workers while the state is malformed.
- "Assign workers": save the state with `factory-state.mjs write` immediately after a worker starts or stops and after each scan changes `scan.stages`. Do not write the state file in another way.
- The existing rules for active workers, earlier attempts, the clear of an attempt after the Story leaves the Stage, and the examination of live harness workers before each assignment stay the same. They now use `attempts` and `scan.stages`.
- Start checklist: add a check "State file". `factory-state.mjs read` succeeds (`FAIL` if not). If the Project is in Git, `git -C <root> check-ignore -q .rowbly/state.json` succeeds (`WARN` if not, with the repair "add `.rowbly/state.json` to `.gitignore`").
- "Stop the factory": remove the step "Delete the temporary directory". Keep the state file.
- Tell workers and the supervisor not to stage or commit `.rowbly/state.json`.

## Acceptance criteria

- [ ] `factory-state.mjs read` with no `state.json` prints an empty version 1 state, exits 0 and creates no file.
- [ ] `write` followed by `read` returns the same `scan.stages` and `attempts`, including extra keys in an attempt, and a new `updatedAt`.
- [ ] A restart test: write a state with one `running` attempt and one `completed` attempt, then `read` in a new process returns both attempts unchanged.
- [ ] `read` of a malformed file (bad JSON, or a valid JSON document that fails validation) exits 1, writes an error with the absolute path of `state.json` and a repair hint, and does not change the file.
- [ ] `write` with invalid input exits 1 and leaves the earlier `state.json` byte-for-byte unchanged.
- [ ] `write` fails when the file cannot be replaced (for example, a read-only `.rowbly/` directory). The earlier `state.json` stays unchanged and valid, and no `state.json.tmp-*` file stays.
- [ ] `read` and `write` fail with the path when `<root>/.rowbly/` does not exist.
- [ ] `skills/factory/SKILL.md` uses `<root>/.rowbly/state.json` through `factory-state.mjs` for all persistent state. It has no instruction to make or delete a temporary directory and no reference to `workers.json` or `stages.json`.
- [ ] `SKILL.md` tells the supervisor to stop before any assignment if `read` fails.
- [ ] `SKILL.md` has the "State file" checklist item and says that the supervisor and workers do not stage or commit `.rowbly/state.json`.
- [ ] `.claude/skills/factory/` and `.agents/skills/factory/` are identical to `skills/factory/` (`diff -r` shows no difference, excluding `node_modules`).
- [ ] The repository `.gitignore` has `/.rowbly/state.json` and `/.rowbly/state.json.tmp-*`. `git check-ignore .rowbly/state.json` succeeds, and `git check-ignore .rowbly/rowbly.config.json .rowbly/stories/ROW-01.md` fails. A test or a check in the PR description shows this.
- [ ] `pnpm test:factory` runs the tests of `watch-stages.mjs` and of `factory-state.mjs`, and they pass.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build` pass.

## Technical notes

- Files: `skills/factory/SKILL.md`, `skills/factory/scripts/factory-state.mjs` (new), `skills/factory/scripts/factory-state.test.mjs` (new), the two installed copies, `package.json` (`test:factory`), `.gitignore`.
- Follow the style of `watch-stages.mjs`: plain Node ESM, no dependencies, `parseArgs`, exit code 2 for a usage error. Tests run the script as a subprocess, as `watch-stages.test.mjs` does.
- Write the new `SKILL.md` text in STE (see `AGENTS.md`).
- `package.json` `files` already ships `skills/` and excludes `skills/**/*.test.*`, so the helper ships with the skill and the test does not.
- Biome ignores `skills/`, `.agents/` and `.claude/`. Knip does not examine the scripts.
- `rowbly doctor` and the services do not list unknown files in `.rowbly/`, so `state.json` does not cause a doctor issue. Verified in `src/services/`.
- The installed copies are tracked by the `skills` list of `.rowbly/rowbly.config.json`. `rowbly install-skill` refuses to overwrite a present skill, so copy the files by hand. Do not change the config.
- The current supervisor data in `/tmp/rowbly-factory.wm67AK/workers.json` (keys `workers`, `history`, `heldEvents`) and `stages.json` (Story to Stage map) are the examples for `attempts` and `scan.stages`. `heldEvents` is not persistent state in version 1.
