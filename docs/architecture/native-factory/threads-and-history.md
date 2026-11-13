# Threads and conversation history

A Thread holds the metadata of one Pi session. The daemon writes the metadata and the Pi history in
`.rowbly/runtime/`. The CLI and the TUI read them without the daemon and without the Pi SDK.

Read this when you change Thread metadata, runs, the Threads tab, Peek or the conversation reader.

## Threads and runs

- A worker Thread belongs to one Story and one Stage attempt.
- Supervisor Threads belong to the Factory.
- A Thread has one or more runs. A resume adds a run to the same Thread. A retry creates a new
  Thread. Each Thread has at most three runs.
- A Thread status is `pending`, `running`, `completed`, `failed`, `cancelled` or `interrupted`.
- A pending Thread is a durable reservation that occupies a worker slot. A Story that waits for a
  slot has a queue note, not a Thread.
- The history of a Thread stays after its Story is deleted.

The `thread/` service reads and writes `runtime/threads/<id>.json` under the state lock. It also
projects Thread changes into the v1 policy state and watches the Thread files for changes.

## Sessions

Each Thread has an exact session reference. The Pi history is in
`runtime/sessions/<id>/<pi-name>.jsonl`. The file reference starts as `null` until Pi writes the file.

## Peek and the conversation reader

The `conversation/` service reads the history of one selected session file. The TUI calls this view
Peek.

- Peek reads current Pi v3 histories without SDK session creation or file writes.
- An unknown format shows a placeholder.
- Only finalized messages appear. Token deltas do not appear.
- Reads use bounded pages. Metadata lists do not load transcripts.
- Read-only history works while the factory is off.
- `rowbly thread log <id> --tail <n>` reads a bounded tail: default 20, maximum 100 entries.

## The supervisor digest

The supervisor does not read worker transcripts in each turn. `supervisor-digest/` gives it bounded
operational facts. The supervisor reads transcript excerpts only through explicit inspection
(`inspect_worker`).

## Related

- [recovery.md](recovery.md): cancel, resume and the interrupted status.
- [controls.md](controls.md): the `thread` commands and the Threads tab keys.
- [../domain-concepts.md](../domain-concepts.md#thread): the definition of a Thread.
