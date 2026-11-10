# Supervisor policy

`scripts/supervisor-policy.mjs` is the supervisor's assignment helper. It does not start workers or read Project files.
Do not call it from `watch-stages.mjs`.

## Scan procedure

1. Load the saved worker state from the factory directory outside the Project.
2. Get current Stories, the config and the Stage prompts through the skill's assignment checks.
3. Get the status of each recorded worker from the harness.
4. Find existing harness workers for this Project, including workers from other supervisors.
5. Call `evaluateScan(state, facts)` one time for each scanner `stories` event.
6. Save the returned `state` before you start a worker or process another scan.
7. Report pending results and save their flags as specified below.
8. Stop the factory if a decision has `action: "stop"`.
9. For each `start` or `retry`, read the current launch inputs again.
10. Check active harness workers and current Stage locks again before launch.
11. Start the worker with the current Project instructions and Stage prompt.
12. Call `recordStart(state, storyId, stageKey, worker)` immediately after a successful launch.
13. Save its returned state before the next assignment.
14. Report the new attempt and save its report flag.

Use the same factory directory after a supervisor restart. Save the complete state with an atomic file replacement.
Keep the scan counter, current worker records and history. Do not replace one attempt with another without `recordStart`.
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

`stories` contains the current Story records from `get-story`, including `agentLock`.
`stages` contains `{ key, enabled, promptClass }` records from the current config and prompt files.
Classify `promptClass` as `work`, `hold`, `invalid` or `missing`. Use the skill's prompt rules.
Do not invent a prompt class or treat an invalid prompt as a hold prompt.

`harnessWorkers` contains `{ story, threadId, status, result? }` for each relevant worker in this Project.
Use `taskId` instead of `threadId` for a subagent. Keep `childThreadId` as additional metadata if present.
Use the same worker ID type in saved records and harness observations.
Normalize terminal statuses to `completed`, `failed` or `interrupted`. All other statuses prevent assignment.
Normalize a successful `blocked` result to `status: "completed", result: "blocked"`.
A failure or interruption without a result gets the result `failed` or `interrupted`.

Decisions contain the Story, Stage, action and reason. Actions are `start`, `retry`, `skip` and `stop`.
A `retry` decision has no delay or attempt limit. It applies only to `IN_REFINEMENT`.
Do not start workers if any decision stops the factory.
An observed Stage departure removes the restriction from the earlier Stage stay. It does not delete the attempt.
For an explicit user request, set `observedStageDeparture: true` on the earlier terminal attempt and save the state.
This flag removes only the earlier attempt restriction. All other assignment checks still apply.

## Saved records

Keep the existing `{ workers, history }` format. Preserve additional fields of the state and worker records.
`workers` maps each Story ID to its latest attempt. `history` contains earlier attempts with their Story IDs.

```json
{
  "scan": 12,
  "workers": {
    "ROW-01": {
      "stage": "IN_REFINEMENT",
      "threadId": "worker-2",
      "status": "running",
      "result": null,
      "reported": false,
      "startReported": true
    }
  },
  "history": [
    {
      "story": "ROW-01",
      "stage": "IN_REFINEMENT",
      "taskId": "worker-1",
      "status": "interrupted",
      "result": "interrupted",
      "stoppedScan": 11,
      "reported": true
    }
  ]
}
```

`scan` increases once per scan and persists across restarts. `stoppedScan` records the first scan that confirmed a stop.
A failure first confirmed on scan 11 can retry on scan 12. A restart does not add another delay.
Legacy terminal records without `stoppedScan` count as earlier confirmed stops. Their `reported: true` does not prevent a retry.
Legacy records without `startReported` count as already reported launches.

## Reports

Call `pendingReports(state)` to get each unsent launch or result report, including reports from history.
For a `started` event, tell the user the Story, Stage and new worker. Identify a retry from its earlier attempt.
For a `stopped` event, tell the user the result and each problem.
After each report, call `markReported(state, report)` and save the returned state immediately.
These flags prevent repeat reports on later scans and restarts. Each attempt has separate flags.
A crash between the message and the saved flag can repeat that message. The harness has no atomic message-and-file operation.
