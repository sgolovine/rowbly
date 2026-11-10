---

title: Automatically retry failed refinement attempts
stage: DONE
position: 2
worktree: null
pull_request: null
---

## Goal

The factory supervisor automatically retries a failed refinement attempt.
A person does not have to request another attempt while the Story stays in refinement.

## Scope

Update the factory skill and its worker records for refinement retries.
Apply the same rule to failed and interrupted refinement workers.
Keep the current rules for development and review attempts.
A refinement result of `blocked` with questions for the user remains distinct from a worker failure.

## Acceptance criteria

- [ ] A failed refinement worker becomes eligible for another attempt without a user request or a Stage change.
- [ ] An interrupted refinement worker follows the same retry rule.
- [ ] The supervisor starts the retry on the next later scan after it confirms that the earlier worker stopped.
- [ ] The supervisor checks existing harness workers and does not start a second active worker for the Story.
- [ ] The retry reads the current Story, Specs, Project instructions and Stage prompt.
- [ ] Worker records preserve each attempt, its worker ID and its result across supervisor restarts.
- [ ] A restart does not leave a failed or interrupted refinement attempt permanently ineligible.
- [ ] A retry does not run when the Stage is disabled, absent or a hold Stage.
- [ ] The supervisor reports failures and retries once per attempt.
- [ ] Failed and interrupted refinement attempts have no attempt limit, backoff or extra delay beyond the next later scan.
- [ ] The skill distinguishes worker failures from a `blocked` refinement result that asks the user for missing information.
- [ ] The bundled and installed factory instructions agree on this behavior.
- [ ] Tests cover failure, interruption, restart recovery, duplicate prevention and a Stage change before a retry.

## Technical notes

The current rules have three separate copies:

- `skills/factory/SKILL.md`
- `.agents/skills/factory/SKILL.md`
- `.claude/skills/factory/SKILL.md`

All three files currently have the same content and different inodes.
Update all installed copies with the bundled copy.
Check for shared paths or symlinks before an edit.
The Assign workers section skips earlier attempts during the same stay in a Stage.
It clears them only after a Stage change or an explicit user request.
Replace this rule for failed and interrupted refinement attempts.

The supervisor owns worker assignment and retry decisions.
`skills/factory/scripts/watch-stages.mjs` reports Stories; it does not assign workers.
Do not move retry decisions into the scanner only to add tests.
The current factory tests cover scanner events, not supervisor decisions.
Add supervisor test cases for retry decisions without a live worker or a running factory.
Cover blocked results, active workers, current Stage locks and disabled or hold Stages.
Cover the next-scan retry policy and repeated failures without an attempt limit.
Keep the current rules for invalid or absent Stage prompts.
Run `pnpm test:factory` if scripts change, and add new test files to that command if necessary.

ROW-01 and ROW-02 demonstrate the problem.
Their interrupted refinement attempts remain in `/tmp/rowbly-factory.wm67AK/workers.json` after a supervisor restart.
Both records have `status: interrupted`, `result: interrupted` and `reported: true`.
The current supervisor treats these records as a reason to skip both Stories.
Use this record shape as a restart test case.
Do not depend on this temporary directory at runtime.

The skill specifies scans about every 30 seconds, or the minimum interval of the harness.
The scanner defaults to five seconds when no interval is supplied.
Neither value defines a retry delay or a retry limit.

The selected policy retries on the next later scan, with no attempt limit.
Do not add backoff or another delay beyond the scan interval.
A scan that first confirms a worker stopped records the result.
The next scan can start the retry after all assignment checks pass.
A `blocked` refinement result does not trigger an automatic retry.
