---
title: Deterministic factory
stories:
  - ROW-120
  - ROW-121
  - ROW-122
  - ROW-123
  - ROW-124
  - ROW-125
---

# Deterministic factory

## Problem

The native factory has a Pi supervisor session. The policy (`factory-policy/`) already decides which Stories can start, in which order, and with which limits. The supervisor only does these jobs:

- It classifies each Stage prompt as `work`, `hold` or `invalid`.
- It calls `start_worker` for the `start` and `retry` decisions of the policy.
- It reads the worker results, and it raises attention entries for problems.
- It keeps notes for the next supervisor session, and it holds Stories.

The 26 supervisor sessions of this Project made these tool calls: 1112 `save_note` and `clear_notes`, 502 `start_worker`, 107 `hold_candidate`, 91 `release_story`, 63 `raise_attention`, 9 `classify_stage` and 0 `stop_worker`. Most holds repeated a worker limit of a machine that the manager already enforces, and some used a lower limit than the settings. All 305 starts with a model used the default worker model.

## Goal

The factory makes all dispatch decisions with fixed rules. No LLM decides which Story gets a worker. The workers stay Pi sessions.

## Decisions

1. **Stage classes.** A rule and the setting `factory.stageClasses` give the class of each Stage. The first and the last Stage are `hold`, a Stage with an empty prompt is `invalid`, and all other Stages are `work`. (ROW-120)
2. **Limits.** The factory uses only the worker limit of each machine and the worker limit of the Project. There is no limit for each Stage. Add one later only if a real problem needs it.
3. **Models.** The model of a worker comes from the factory settings: the Story override, then the tag rule (ROW-123), then the Stage override, then `factory.workerModel`. When its provider is paused, the first model of `factory.fallbackWorkerModels` with a provider that is not paused applies (ROW-121).
4. **Problems.** A worker reports problems with the `blockers` and `problems` fields of `report_result`. The manager makes an attention entry from them (ROW-122).
5. **Dispatch.** The manager reserves a worker for each `start` and `retry` decision, in the launch order of the policy, with a fixed request ID. A retry starts a new Thread. Network resume does not change. (ROW-124)
6. **Removal.** The supervisor session, its tools, the digest, the holds and the notes go away (ROW-124). Then the supervisor settings, CLI options, prompts and TUI views go away (ROW-125). Old supervisor Threads and old config keys stay valid.

## Stories

| Story   | Title                                                             | Depends on              |
| ------- | ----------------------------------------------------------------- | ----------------------- |
| ROW-120 | Set the class of each Stage by a rule and by the factory settings | none                    |
| ROW-121 | Use a fallback worker model when a provider is paused             | none                    |
| ROW-122 | Raise attention from the problems that workers report             | none                    |
| ROW-123 | Select the worker model by the tag of a Story                     | none                    |
| ROW-124 | Start workers from the manager without a supervisor session       | ROW-120 ROW-121 ROW-122 |
| ROW-125 | Remove the supervisor from the settings, CLI, TUI, prompts, docs  | ROW-124                 |

ROW-123 is optional. It keeps the intent of a model rule in a Project prompt.

Each Story keeps the main branch in a state that works, because the factory of this Project builds these Stories.

## Not in scope

- A worker limit for each Stage or for a group of Stages.
- An LLM advisor that only reads the factory state.
- A change to the workers or to their prompts.
