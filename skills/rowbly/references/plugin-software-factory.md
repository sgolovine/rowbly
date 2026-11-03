# Software Factory Plugin

Every command below takes `--json --no-prompt`, and a remove also needs `--yes`.

A **Stage Prompt** is a Markdown file of instructions for an agent working on a Story in one Stage.
Every Stage, Backlog and Done included, can have one, and each is on or off (off by default). Stage
Prompts are set per Stage at the global level (`rowbly.config.json`) or on a Board
(`board.config.json`): a Board's entry for a Stage replaces the global entry for that Stage, and the
other Stages keep the global one. The Plugin is off until `rowbly plugins enable software-factory`.

`ROWBLY.md` describes how people work with the whole Data Root; a Stage Prompt is one Stage's
instructions. Read both before working a Story.

A **Stage Run** records one agent's work on a Story during its current visit to a Stage whose Stage
Prompt is on: `running`, `finished` or `failed`, with an `attempt` number and the `worker`'s name. A
Story has at most one; moving the Story to another Stage removes it, so the Stage is worked again on
the next visit. In the TUI, a running or failed one shows as a `▶ running` / `✕ failed #2` badge on
the Story's card, and the Story's **Stage Run** tab shows all of its fields with their ages.

## Commands

```sh
# Every Stage of a Board with its effective Stage Prompt, in one call
rowbly software-factory stages --board web --json --no-prompt
rowbly software-factory stages --level global --json --no-prompt   # the global level alone

rowbly software-factory prompt show todo --board web --json --no-prompt   # {key, name, category, prompt}
rowbly software-factory prompt enable todo --board web --json --no-prompt  # no file: copies the global file, else a template
rowbly software-factory prompt enable todo --level global --json --no-prompt
rowbly software-factory prompt edit todo --board web --file ./todo.md --json --no-prompt
rowbly software-factory prompt disable todo --board web --json --no-prompt # keeps the file
rowbly software-factory prompt remove todo --board web --yes --json --no-prompt  # entry and file, this level only

# Stage Runs
rowbly software-factory runs --board web [--stale-after 15] --json --no-prompt   # Stories in Stages whose Stage Prompt is on
rowbly software-factory wait --board web --since <digest> --timeout 600 [--stale-after 15] --json --no-prompt   # blocks until runs change
rowbly software-factory run start WEB-42 --worker "WEB-42 worker" --json --no-prompt
rowbly software-factory run attach WEB-42 --stage todo --attempt 1 --started-at <timestamp> --worker <id> --machine <name> --harness <name> --thread-id <id> --source "<launch receipt>" --json --no-prompt
rowbly software-factory run touch WEB-42 --stage todo --attempt 1 --started-at <timestamp> --worker <id> --source "<verified activity>" --json --no-prompt
rowbly software-factory run finish WEB-42 --json --no-prompt
rowbly software-factory run fail WEB-42 --reason "checks failed" --json --no-prompt
rowbly software-factory run start WEB-42 --worker "WEB-42 worker" --retry --json --no-prompt   # a failed one, next attempt
rowbly software-factory run clear WEB-42 --json --no-prompt          # work the Stage again

# Holds: a person keeps a Story out of Stage Runs, and gives it back
rowbly software-factory hold WEB-42 --reason "pairing on it by hand" --json --no-prompt   # {key, hold}
rowbly software-factory release WEB-42 --json --no-prompt            # {key, released}

# A worker's reported block (supervisor only): check it, then run what it allows
rowbly software-factory apply WEB-42 --file block.md --dry-run --json --no-prompt
rowbly software-factory apply WEB-42 --file block.md --json --no-prompt
```

`stages --json` returns:

```json
{ "board": "web", "stagesSource": "global",
  "stages": [{ "key": "todo", "name": "Todo", "category": "board",
    "prompt": { "enabled": true, "configured": true, "source": "board",
      "path": "boards/web/plugins/software-factory/stage-prompts/todo.md", "exists": true,
      "text": "# Todo\n\n…" } }] }
```

`enable`, `disable` and `edit` return the `prompt` object of the level they changed.

`runs --json` returns `{ board, stages, stories: [{ key, name, stage, stageRun, liveness, runMetadata, eligibility }], staleAfterMinutes, digest }`, where
`stages` are the Stages whose Stage Prompt is on, `stageRun` is `null` for a Story nobody works in
this visit, and `digest` changes whenever `stages` or `stories` do, except for each Run's age. `wait` blocks until `runs`
differs from `--since <digest>` (without it, from when it starts) and returns `runs` with
`changed: true`: a Story entered or left a Stage whose Stage Prompt is on, a Stage Prompt was turned
on or off, a Stage Run started, ended or was cleared, or eligibility changed. A stale `--since`
returns at once. After `--timeout <seconds>` it returns `changed: false`. Both exit 0; a signal
stops it (exit 130 or 143). `run start`, `finish` and `fail` return `{ key, stageRun }`, with `stageRun`
`{ stage, status, attempt, worker, by, startedAt, finishedAt?, reason? }`; `run clear` returns
`{ cleared }`.

`apply --json` returns `{ key, stageRun, dryRun, commands: [{ line, text, argv, decision, reason?,
exitCode?, output? }] }`, in the order the lines run (moves last). `decision` is `apply`, `hold`,
`drop` or `reject`; `exitCode` and `output` (the command's JSON result or error) are set once a line
ran. A refused block or a failed line exits non-zero with the same object in `error.details`.

## Rules

- Follow a Stage Prompt only when `prompt.enabled` is `true`. It is true only when the setting is on
  (`configured`), `path` points inside the Plugin's folder for its level, and the file exists.
- `source` is `board`, `global` or `null` (no entry). Without `--board`, writes go to the current Board;
  `--level global` writes the global entry and cannot be combined with `--board`.
- Text comes from `--text`, `--file <path>` or `--file -` (stdin). Do not use `--edit`.
- `enable`, `disable` and `edit` exit 3 (`NOT_FOUND`) for a Stage that level does not have.
- A new Board entry made by `edit` starts with the global entry's on/off setting.
- `run start` exits 4 (`CONFLICT`) when the Story's Stage has no Stage Prompt that is on, or when the
  Story already has a Stage Run for this visit. Only a `failed` one can be started again, with
  `--retry`. `finish` and `fail` exit 4 unless a Stage Run is `running`; `clear` exits 3 when there is
  none.
- A Stage Run for another Stage than the Story's (left by a git merge or a hand edit) does not count.
- `apply` allows only `stories edit|move`, `comments add|edit`, `tasks create|edit|move`,
  `specs create|edit --story` and `story-linking add|remove --blocks`, each about the given Story as
  its first argument (or `--story`) and writing only it. It splits lines with shell quoting but runs
  no shell: shell syntax, `$` or a backtick in double quotes, another Story, `--blocked-by` (Story
  Linking stores a link on the blocker, so it writes the other Story), `software-factory` commands,
  short options and `--data-root`, `--board`, `--yes`, `--prompt`, `--edit`, `--*-file`,
  `--story-spec`, `--from-clipboard`, `--finished-run` reject the line, and one rejected line refuses
  the block (exit 2, nothing ran).
- `apply` runs `stories move` last and only when the Stage Run is `finished`: it is `hold` while the
  Stage Run runs or when there is none, and `drop` after `failed`. Re-submit a held move after
  `run finish`. One move per block.
- `apply` runs the move as `stories move <KEY> <stage> --finished-run <stage>/<attempt>/<startedAt>`
  of the Run it read. That move's own guard checks the Run again under the Data Root lock: when it
  was cleared or replaced meanwhile (another attempt, Stage or start), the move exits 4
  (`CONFLICT`) and changes nothing. The option works on any `stories move`.
- Each allowed line runs as its own `rowbly … --json --no-prompt` on the same Data Root. The first
  that fails stops the block with that command's exit code; earlier lines stay applied.
- To wait for work, pass `wait` the `digest` of the `runs` you last acted on, never a fresh one: a
  change between your read and the wait then returns at once instead of being missed.
- Data: `"plugins": { "software-factory": { "stageRun": { … } } }` in the Story's `story.json`.

`eligibility` is `{ eligible, reasons: [{ code, message, blockers? }] }`, separate from the Stage
Run. With Story Linking on, unfinished incoming blockers produce a `BLOCKED` reason and
`blockers: [{ key, name, stage }]`; the table shows the reason. `run start`, including `--retry`,
refuses them with exit 4 (`CONFLICT`) and `details.eligibility`, saving no Run or attempt change.
Moving each blocker to a Stage of category `done` restores eligibility on the next `runs` call;
links remain recorded. Supervisors skip blocked Stories and reconsider them after Board changes.
Invalid linking data fails explicitly (exit 6), and an enabled but unavailable provider fails the
query rather than reporting no blockers. With Story Linking off, its preserved data is ignored.
An eligible Story still needs the appropriate Stage Run state to start or retry.

With Software Factory on, each Stage heading in the Board's Stages view has a clickable `✎`.
It opens that Stage's effective Stage Prompt in the fullscreen viewer, including when the prompt
is off or missing (a missing file starts with a template). `tab` or `e` switches to editing;
`ctrl+s` saves, and closing unsaved edits asks before discarding them. Saving writes the shown
Board's own Stage Prompt, preserving its on/off setting; an inherited prompt becomes a Board
entry with the global entry's setting. Use Stage Prompts in Settings to change that setting.

A **hold** (`{ version: 1, reason, by, heldAt }`) stays through Stage changes and never changes the
Stage Run, so `release` gives the Story back with its attempt. A held Story's `eligibility` has a
`HELD` reason, and `run start` exits 4 (`CONFLICT`) for it, `--retry` included. `hold` exits 4 for a
Story already held; `release` exits 3 for one that is not.

## Data

- Global: `"plugins": { "software-factory": { "enabled": true, "stagePrompts": { "todo": { "enabled": true, "path": "plugins/software-factory/stage-prompts/todo.md" } } } }` in `rowbly.config.json`.
- Board: `"plugins": { "software-factory": { "stagePrompts": { … } } }` in `boards/<board>/board.config.json`,
  with files in `boards/<board>/plugins/software-factory/stage-prompts/<key>.md`.
- `path` is relative to `.rowbly/`.
- Hold: `boards/<board>/stories/<KEY>/plugins/software-factory/hold.json`, a file of its own, not in the Story's bag.

## Verified worker identity

Start records a launch hint; only `run attach` records a supervisor-attested actual identity.
Keep the worker waiting for GO until launch verification, attachment and Board publication succeed.
Use the exact Stage/attempt/start time returned by start, actual worker/machine/harness/thread ID,
and the verification source. Me and the operation clock supply `by` and `verifiedAt`; Rowbly does
not contact the harness. Conflicting identity or a changed/non-running Run exits 4 (`CONFLICT`).
Identical inputs write nothing and keep the original verification time. A legacy Run without a
file can be attached; opaque metadata exits 6 (`DATA_INTEGRITY`) without changing it.

`runs --json` rows include `runMetadata: {status,current,...}`. Status is `absent`, `valid`, `invalid`
or `unsupported`. A current valid file exposes `version:1`, `run:{stage,attempt,startedAt}` and its
optional `identity`, `selection` and `heartbeat`. Stale valid data has `current:false` and exposes
none of those sections. Invalid/unsupported data includes `message`. Human `stories show` and TUI
Story Details show identity; `stories show --json` remains the stored Story. Use `runs --json` for
structured metadata. Changes to it affect `digest`, so `wait` resumes after attachment.

The file is `boards/<board>/stories/<KEY>/plugins/software-factory/run-metadata.json`, strict v1.
Unknown fields/versions and unreadable bytes are kept unchanged and unavailable. Same-Run writes
preserve other sections' JSON values. Every new start/retry resets recognized metadata even when
timestamps repeat; clear and Stage changes remove recognized metadata, finish/fail keep it. A
start refuses opaque metadata until explicit repair. Older releases keep the file but cannot
maintain its verified lifecycle. A selection command is planned separately.

After restart, resolve `identity.threadId` through `identity.harness` on `identity.machine`.
A title or legacy worker string is only a hint; do not assume a remote ID is local, or that an
unreachable worker is absent. A confirmed launch failure ends the Run with `run fail --reason`.
Uncertain launch, attachment or publication needs reconciliation before GO, clearing or retrying.
Capture the old metadata in retry context before a retry replaces it. No age implies permission to
clear, retry or end a Run.

## Heartbeats and stale Runs

`run touch` saves the current Run's `heartbeat: {worker, at, source, by}`. Run it only when you
verified the attached worker's activity: a message from it or an event from its harness, named in
`--source`. Polling, a reachable worker or a harness status is not activity. It needs the current
running Run (exact stage/attempt/startedAt) and an attached identity for `--worker`, else exit 4
(`CONFLICT`) with nothing written; opaque Run details exit 6. It keeps identity and selection.

Running rows of `runs` have `liveness: {lastSeenAt, heartbeat: reported|none|unavailable,
ageSeconds, stale}`; others `null`. With no heartbeat, `lastSeenAt` is `null` and the age counts
from `startedAt`. `stale` is age >= `--stale-after` minutes (default 15); pass the same value to
`runs` and `wait`. The digest omits `ageSeconds`: it changes on a saved heartbeat and once when a Run
becomes stale (seen by `wait` within a minute), never on time alone.

A stale Run is a reason to check the worker, never to clear, fail, retry or start another worker.
Check it through its recorded identity: touch on new verified activity; `run fail --reason` when it
is verifiably gone; otherwise report it to the user. A worker waiting for a person stays as it is.

## Doctor

`SOFTWARE_FACTORY_MISSING_PROMPT` (warning): a Stage Prompt is on but its path is not set, points
outside the Plugin's folder, or its file is missing or cannot be read (Rowbly does not follow a
symbolic link). Nothing is fixed; create the file with
`prompt edit`, or turn the Stage Prompt off, when the user asks.

`SOFTWARE_FACTORY_UNREADABLE_HOLD` (warning): a Story's
`boards/<board>/stories/<KEY>/plugins/software-factory/hold.json` is not JSON, is invalid, has a
`version` or fields this Rowbly does not support, or cannot be read (a symbolic link is not followed). The Story counts as held, and `hold` and `release` exit 6
(`DATA_INTEGRITY`) without changing it. Nothing is fixed; ask the user to repair or delete the file.

`SOFTWARE_FACTORY_RUN_METADATA_INVALID` and `SOFTWARE_FACTORY_RUN_METADATA_UNSUPPORTED_VERSION`
(warnings): unreadable/malformed/unknown-field metadata or a version other than 1. A heartbeat
without matching identity is invalid. No automatic fix; bytes are preserved for explicit repair.

## Common mistakes

- **HIGH: starting work on a held Story, or releasing someone else's hold to start it.** A person
  holds a Story to work it by hand (`software-factory hold`); its eligibility has a `HELD` reason
  that says who and why. Skip it and report the reason. Only the person, or the user, releases it.
- **HIGH: starting work on a Story whose `stageRun` is not `null`.** Another agent works it, or has
  finished, in this visit. Run `run start` first and act only when it succeeds; exit 4 means leave it.

- **MEDIUM: reading `configured` as on.** A Stage Prompt whose file is gone has `configured: true` and
  `enabled: false`; do not follow it, and tell the user.
- **MEDIUM: `remove` to turn a Board's Stage Prompt off.** Removing the Board entry falls back to the
  global one, which may be on. Use `prompt disable` to turn it off for that Board.

In TUI Settings, choose Stage Prompts under Global or Board: <name>. The section fixes the read/write
scope; there are no scope tabs or `l` shortcut. Without a Board, only Global appears. Board Stages
without their own entry use the global Stage Prompt. Editing or toggling creates a Board entry for
that Stage. Removing its entry and file restores the global prompt; turning it off keeps the Board
entry and prevents the global prompt from applying.
