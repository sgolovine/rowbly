---

title: Store factory state in .rowbly/state.json
stage: BACKLOG
worktree: null
pull_request: null
---

## Goal

Store factory supervisor state in `.rowbly/state.json` instead of a `workers.json` file in a temporary directory.
Keep this local state out of Git.

## Scope

Use one state file for each Project.
Keep worker records and scan state in this file so the supervisor can resume after a restart.
Update the factory skill, its installed copies and related scripts to use the Project state file.
Add `.rowbly/state.json` to the repository `.gitignore`.
Do not ignore other files in `.rowbly/`.

## Acceptance criteria

- [ ] The factory stores its state at `<root>/.rowbly/state.json`.
- [ ] The state includes Story IDs, Stages, worker IDs, attempt results and the scan state used for assignment.
- [ ] A supervisor restart reads this file and preserves active workers and earlier attempt results.
- [ ] The factory does not use a temporary `workers.json` or separate temporary scan state as its persistent state.
- [ ] A Project without a state file can start a new factory.
- [ ] A malformed state file produces an error with its path and repair instructions.
- [ ] A malformed state file does not cause duplicate worker assignment.
- [ ] State writes preserve valid JSON if a write fails or the supervisor stops.
- [ ] `.gitignore` excludes `.rowbly/state.json` and keeps other Project files visible to Git.
- [ ] The factory does not stage or commit the state file.
- [ ] Bundled and installed factory instructions use the same path and restart rules.
- [ ] Tests cover startup, restart, malformed state, failed writes and Git exclusion.

## Technical notes

The current supervisor uses `/tmp/rowbly-factory.wm67AK/workers.json` and `stages.json`.
Use these records as examples of the data that must persist.
Define the state format and the treatment of an earlier temporary state file during refinement.
Keep the scanner responsible for Story events and the supervisor responsible for worker assignment.
