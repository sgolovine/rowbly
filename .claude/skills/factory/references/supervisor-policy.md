# Supervisor policy

`scripts/supervisor-policy.mjs` is the supervisor's assignment helper. It does not start workers or read Project files.
Do not call it from `watch-stages.mjs`.

## Scan procedure

1. Read `<root>/.rowbly/state.json` through `factory-state.mjs read --root <root>`.
2. If the read fails, report the path and hint. Stop before any assignment.
3. Get current Stories, the config and the Stage prompts through the skill's assignment checks.
4. Get the status of each recorded worker from the harness.
5. Find existing harness workers for this Project, including workers from other supervisors.
6. Call `evaluateScan(state, facts)` one time for each scanner `stories` event.
7. Save the returned `state` before you start a worker or process another scan.
8. Report pending results and save their flags as specified below.
9. Stop the factory if a decision has `action: "stop"`.
10. For each `start` or `retry`, read the current launch inputs again.
11. Check active harness workers and the state records again before launch.
12. Start the worker with the current Project instructions and Stage prompt.
13. Call `recordStart(state, storyId, stageKey, worker)` immediately after a successful launch.
14. Save its returned state before the next assignment.
15. Report the new attempt and save its report flag.

Use the same state file after a supervisor restart. Save only through `factory-state.mjs write --root <root>`.
Give the full JSON document on stdin. Stop before another assignment if the write fails.
Keep `scan.count`, `scan.stages` and all `attempts`. Use `recordStart` to add each new attempt.
If a launch fails without a worker ID, report the harness error. Check existing harness workers before another launch.
If the harness cannot confirm a worker's status, keep it active or unknown. Do not infer interruption from absence.

## Inputs and decisions

Import the functions from the installed skill path:

```js
import {
  evaluateScan,
  recordStart,
  pendingReports,
  markReported,
} from "./scripts/supervisor-policy.mjs";

const { state: nextState, decisions } = evaluateScan(state, {
  stories,
  stages,
  harnessWorkers,
});
```

`stories` contains the current Story records from `get-story`.
`stages` contains `{ key, enabled, promptClass }` records from the current config and prompt files.
Classify `promptClass` as `work`, `hold`, `invalid` or `missing`. Use the skill's prompt rules.
Do not invent a prompt class or treat an invalid prompt as a hold prompt.

`harnessWorkers` contains `{ story, workerId, status, result? }` for each relevant worker in this Project.
The duplicate checks use only the state records and this list.
Supervisors in separate checkouts or on separate machines do not share `state.json`.
Only this list can find the workers of those supervisors.
The helper also accepts `threadId` or `taskId` from the harness. It saves the ID as `workerId`.
Keep `childThreadId` as additional metadata if present.
Normalize active statuses to `preparing` or `running`. Normalize terminal statuses to `completed`, `failed`, `blocked` or `interrupted`.
Unknown harness statuses prevent assignment. Confirm their status before you save the state.
A successful `blocked` result can use `status: "blocked", result: "blocked"`.
A failure or interruption without a result gets the result `failed` or `interrupted`.

Decisions contain the Story, Stage, action and reason. Actions are `start`, `retry`, `skip` and `stop`.
A `retry` decision has no delay or attempt limit. It applies only to `IN_REFINEMENT`.
Do not start workers if any decision stops the factory.
An observed Stage departure removes the restriction from the earlier Stage stay. It does not delete the attempt.
For an explicit user request, set `observedStageDeparture: true` on the earlier terminal attempt and save the state.
This flag removes only the earlier attempt restriction. All other assignment checks still apply.

## Saved records

Use version 1 of the state format. Keep additional fields of the state and attempt records.
`attempts` contains all attempts in launch order. The last attempt for a Story controls its Stage stay.
Do not remove earlier attempts or their report flags.

```json
{
  "version": 1,
  "updatedAt": "2026-11-10T12:00:00.000Z",
  "scan": {
    "count": 12,
    "stages": { "ROW-01": "IN_REFINEMENT" }
  },
  "attempts": [
    {
      "story": "ROW-01",
      "stage": "IN_REFINEMENT",
      "workerId": "worker-1",
      "workerType": "thread",
      "model": "gpt-sol",
      "status": "interrupted",
      "result": "interrupted",
      "startedAt": "2026-11-10T11:00:00.000Z",
      "stoppedAt": "2026-11-10T12:00:00.000Z",
      "stoppedScan": 11,
      "reported": true,
      "startReported": true
    }
  ]
}
```

`scan.count` increases once per scan and persists across restarts. `scan.stages` records the Stage of each Story at that scan.
`stoppedScan` records the first scan that confirmed a stop. A failure first confirmed on scan 11 can retry on scan 12.
A restart does not add another delay. Terminal records without `stoppedScan` count as earlier confirmed stops.
Their `reported: true` does not prevent a retry. Records without `startReported` count as already reported launches.
Supply `workerType`, model and options from the launch result to `recordStart`. It records the ID and start time.
Save the returned state after each scan, launch, confirmed stop and report flag change.
Do not import earlier temporary state. Do not stage or commit the state file or its temporary files.

## Reports

Call `pendingReports(state)` to get each unsent launch or result report, including reports from earlier attempts.
For a `started` event, tell the user the Story, Stage and new worker. Identify a retry from its earlier attempt.
For a `stopped` event, tell the user the result and each problem.
After each report, call `markReported(state, report)` and save the returned state immediately.
These flags prevent repeat reports on later scans and restarts. Each attempt has separate flags.
A crash between the message and the saved flag can repeat that message. The harness has no atomic message-and-file operation.
