# Threads and conversation history

A Thread holds the metadata of one Pi session. The daemon writes the metadata and the Pi history in
`.rowbly/runtime/`. The CLI and the TUI read them without the daemon and without the Pi SDK.

Read this when you change Thread metadata, runs, the Threads tab, Peek or the conversation reader.

## Threads and runs

- A worker Thread belongs to one Story and one Stage attempt.
- The factory does not create supervisor Threads now. Old supervisor Threads belong to the Factory.
  They stay valid, and `rowbly thread list`, the history and the TUI show them.
- A new worker Thread has no parent Thread.
- A Thread has one or more runs. A resume adds a run to the same Thread. A retry creates a new
  Thread. Each Thread has at most three runs.
- A Thread status is `pending`, `running`, `completed`, `failed`, `cancelled` or `interrupted`.
- A pending Thread is a durable reservation that occupies a worker slot. A Story that waits for a
  slot has a queue note, not a Thread.
- The history of a Thread stays after its Story is deleted.
- A worker Thread can have a short `checks` list: the last 20 checks of the worker, with the job id,
  check key, scope, status, `HEAD` and duration. The thread pane of the Factory view shows the last
  three. See [checks.md](checks.md#records).
- A Thread has a `host`: the ID of the machine that runs it. The value is `local` (`LOCAL_HOST`) for
  all current work. The manager writes `host` to each new worker Thread. A supervisor Thread has no
  `host` in its file. A Thread file without `host` reads as `local`. Rowbly gives this default in one
  place, when it reads the file, so that all readers get the same value. A save after a read writes
  the field. `rowbly thread list` and `rowbly thread show` show the host. A `host` must be a string
  that is not empty.
- The projection copies the `host` of a worker Thread to its attempt in `state.json`. An attempt
  without `host` ran on the local host. The `threads` entries of `status.json` and the active worker
  entries of the manager also have the host.
- A worker Thread has `storyUid`: the `uid` of its Story. The manager writes it to each new worker
  Thread. A Story without a `uid` gives a Thread without `storyUid`. An old Thread file without
  `storyUid` stays valid. A `storyUid` must be a string. The projection copies `storyUid` to the
  attempt.
- `listThreads({ story })` finds the Threads of a Story by the rule of `matchStoryRef` (see
  [Story references](README.md#story-references)). Thus the Threads of a Story stay with the Story
  when its number changes. A Thread that matches no Story, for example of a deleted Story, matches by
  its `storyId`.

The `thread/` service reads and writes `runtime/threads/<id>.json` under the state lock. It also
projects Thread changes into the v1 policy state and watches the Thread files for changes.

`listThreads` keeps a cache of the valid Thread records in each process (`thread-cache.ts`). The key is
the absolute file path. Before each read, `listThreads` does a `stat` of the file. If the `ino`, the
`size` and the `mtimeNs` are the same as in the cache, it does not read the file again. An atomic save
gives a new `ino`, thus the next list reads the file. A file that is not valid is not in the cache, and
it gives an issue on each list. `getThread` reads the file each time. The symlink checks of the Thread
file and of its session reference occur on each list, also when the record is in the cache.

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
- A watch polls every 500 ms. If the `stat` of the Thread file and of the session file did not change
  since the last successful poll, the poll stops before it reads the Thread or a page.
- `rowbly thread log <id> --tail <n>` reads a bounded tail: default 20, maximum 100 entries.

## Related

- [recovery.md](recovery.md): cancel, resume and the interrupted status.
- [controls.md](controls.md): the `thread` commands and the Threads tab keys.
- [../domain-concepts.md](../domain-concepts.md#thread): the definition of a Thread.
