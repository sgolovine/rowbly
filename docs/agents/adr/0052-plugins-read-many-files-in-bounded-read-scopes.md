# ADR-0052: Plugins read many files in bounded read scopes, and Plugin code never runs under the lock

**Status:** Accepted. Built.

Every Plugin `files.read` and `files.list` is its own read scope (ADR-0019 §5): it enters the Git
publication gate, takes the Data Root lock, recovers, reads and releases. Each acquisition writes and
syncs two lock files. Opening a Story ran ten acquisitions for the rows and badges of the Built-in
Plugins, and opening Find Stories ran one or more per Story, because Specs and Epics read their
files for each Story on its own. Measured on 501 Stories with 50 ms added to each lock file write,
building the finder's index took 57 s. A held publication gate delays every one of these reads.

## 1. Batched file reads

`PluginFiles` gains `readMany(requests)` and `listMany(scopes)`.

- **Results.** `result[i]` answers `requests[i]` (or `scopes[i]`): `{ status: 'found', text }`
  (`{ status: 'found', names }` for a listing), `{ status: 'missing' }` where `read` gives `null`, or
  `{ status: 'failed', code, message }`. Duplicate requests each get their own entry; within one
  batch they are read once.
- **Checked first.** Every scope and name is checked as `read` and `list` check them, before anything
  is read. One that is invalid rejects the call.
- **What fails one entry.** A Story or Board scope that does not exist (`NOT_FOUND`), a filesystem
  error on that file or folder, and the symbolic link policy (ADR-0019 §10) refusing it. A caller may
  show these as unavailable.
- **What fails the call.** Entering the publication gate or recovering a publication, a busy Data
  Root (`CONFLICT`), recovering an interrupted commit, and a core record that cannot be read while a
  scope is resolved (`DATA_INTEGRITY`): the call rejects with the original error and returns no
  partial result. Core never retries a batch.
- **Batches.** `readMany` reads at most 32 requests in one read scope. `listMany` lists at most 32
  scopes in one; it takes no further scope once 256 names were listed. That threshold is checked after
  each whole scope, so one scope can list more: it is a soft stop. Neither limit bounds the files
  read to resolve a scope, the filesystem calls of one listing, or time.
- **Between batches** the read scope is released and the next batch takes the lock again, as any read
  does: callers already waiting for the lock in this process go first, in the order they arrived
  (ADR-0019 §1). Nothing stronger is promised; waiters in other processes retry with backoff. Each
  batch sees one committed state, and consecutive batches may see different ones, as consecutive read
  scopes may (ADR-0019 §5). Inside an operation every batch reuses the operation's lock.

`read`, `readBinary` and `list` do not change.

## 2. Search text loads once per search

`PluginTui` gains `loadStorySearchText({ stories, plugin })`, which returns a function from a Story
to its searchable text, as `loadStoryBadges` does for badges (ADR-0028). The finder calls it once each
time it opens, for the Stories it searches, after reading them, and before calling each Plugin's
`storySearchText` per Story; both add text. A load that fails leaves that Plugin's text out of that
search, and a function that throws leaves it out for that Story; the Story itself is always found. It
is not retried, and nothing is cached between searches, so every search reads current data.

Specs and Epics move their search text to it: Specs reads every Story Spec and each linked Board Spec
once per search, Epics each Epic file.

## 3. What core holds the lock for

Core holds the lock only for its own reads and for these batches. A screen groups core reads, such as
the Story screen's Story and effective configuration, into one read scope; it never holds the lock
while a Plugin row, badge, search or other callback runs, so a slow callback cannot delay a change
or another read. The finder's Board, Story and configuration reads stay the separate read scopes they
were.

## Rejected

- **One read scope around all of a screen's Plugin callbacks.** It would take one acquisition, and the
  Story Context does so (ADR-0044), but a callback's time is not bounded: one slow row would hold every
  change behind it.
- **One read scope around the finder's whole index.** It covers every Board and Story of the Data Root.
- **Caching the finder's index between searches.** After batching, building it for 501 Stories took
  0.2 s, and 2.7 s with 50 ms per lock file write. A cache would need invalidation on every change of a
  Story, Board, Plugin or Plugin file, and could show deleted or stale results.
- **A shared lock for readers.** ADR-0019 §1 rejected it: it is hard to build portably on exclusive-create
  files.
