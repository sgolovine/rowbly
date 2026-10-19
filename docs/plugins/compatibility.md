# Plugin compatibility policy

This page says how the Plugin API and Plugin Data may change between Rowbly releases, and what an older or newer Rowbly does with data it does not understand. It is policy. Rowbly builds no migration engine, no version-range engine and no dependency graph for it. The decision is recorded in [ADR-0021](../adr/0021-plugin-format-and-compatibility-policy.md). The trust model is in [trust.md](trust.md).

The terms are those of [`CONTEXT.md`](../agents/CONTEXT.md) (Plugin, Built-in Plugin, Plugin Data, Data Root) and of ADR-0020 §3 (the four bag kinds: absent, valid, invalid and unsupported).

## 1. Three different versions

Rowbly has three kinds of version. They change for different reasons, and no one of them stands in for another.

| Version | What it identifies | Where it is today |
| --- | --- | --- |
| **API version** | The contract between Rowbly and a Plugin's code: the exports of `src/plugin-api` and `src/plugin-api/tui`, the stage contexts, the hook events and the operation results. | None. The API is internal and unreleased (§2). |
| **Package version** | A release of a piece of software: Rowbly itself, or (in future) an external Plugin package. | Rowbly's `package.json` `version`. Built-in Plugins have none; they ship with Rowbly. |
| **Storage version** | The shape of persisted data. | Core records carry `version: 1` (`rowbly.config.json`, `board.config.json`, `story.json`, `local.json`). The transaction manifest carries `version: 1` (ADR-0019 §2). Epic files carry `version: 1`. Built-in bags carry none and are read as legacy v1 (§3.2). |

A new Rowbly release does not imply a new API version or a new storage version. A new storage version of one Plugin's data does not imply a new API version.

## 2. The Plugin API

### 2.1 Today: internal and unreleased

- Only Built-in Plugins exist. They are compiled into the same bundle as core and listed in one static registry (ADR-0009). They always match the host they ship with.
- The Plugin API therefore has no version number and makes no compatibility promise. A Rowbly release may change any export, context or event, as long as it updates every Built-in Plugin, fixture and compile fixture in the same change.
- `rowbly.config.json` can enable only Plugins that this Rowbly has. An enabled ID that this Rowbly does not have is reported (`this version of Rowbly does not have it`, `PLUGIN_FAILED` in doctor). No code is loaded for it, and its data is kept.

### 2.2 Before any external Plugin package is accepted

These are requirements for the release that first loads code that does not ship with Rowbly (not scheduled). None of them is built now.

1. **One API version number.** Choose a single integer API major version, published by Rowbly (for example as an export of `src/plugin-api`). A Plugin declares the major version it was built against. Use a range only when a real Plugin needs to support two majors at once. Do not build a semver-range engine before then.
2. **Check before activation.** The host compares the declared version with its own before it parses settings, stages a surface, or calls `start`. An incompatible Plugin fails to load as a whole, like any other load failure: its data is kept and the rest run without it.
3. **Report both versions.** `plugins list`, `plugins show` and doctor's `PLUGIN_FAILED` name the required and the actual API version and say which side to upgrade.
4. **Keep built-ins simple.** A Built-in Plugin does not declare a version by hand. It is compatible by construction.
5. **Change rules.**
   - *Breaking* (needs a new major): removing or renaming an export, a context member, an event field or an operation; narrowing an accepted input; widening a result or callback argument in a way existing code cannot handle; changing a stage's capabilities; changing when or how often a callback runs.
   - *Additive* (same major): a new export, a new optional context member, a new optional definition key, a new hook point, a new error `details` key.
   - *Deprecation*: a deprecated member keeps working for at least one release in the same major. It is marked `@deprecated` with its replacement, and the release notes list it.
   - *Release notes*: every release that changes the Plugin API lists the change and its class (breaking, additive or deprecation).
6. **Shared libraries.** Libraries whose objects cross the API boundary (`zod`, `commander`, `react`, `ink`) are provided by the host, not bundled by each Plugin. A major upgrade of one of them is a breaking API change.

**Tests when scheduled:** an external definition that declares an incompatible major fails before `start` runs and its reason names both versions; a compatible one loads and runs; Built-in Plugins need no declaration.

## 3. Plugin Data formats

### 3.1 Ownership

- Each Plugin owns the shape of its own bags (`plugins.<id>` on a record) and of its own files (`plugins/<id>/…`, ADR-0011, ADR-0013). Core never interprets them.
- Core keeps the bags and files of Plugins that are off or unknown exactly as stored, and it keeps the files of every Plugin when it moves or deletes a Story or Board folder.
- A Plugin reads its own bags only through `inspectBag`, `readBag` or `requireBag`, with its own schema (ADR-0020 §3). A parse failure never means "empty".
- The current keys stay: Epics `plugins.epics.epic`, Specs `plugins.specs.specs`, Comments `plugins.comments.comments`. No evidence justifies renaming them.

### 3.2 Built-in formats today

| Plugin | Data | Storage version |
| --- | --- | --- |
| Epics | Story bag `{ "epic": "<slug>" }` | legacy v1 (no `version` key) |
| Epics | Data Root file `plugins/epics/<id>.json` | explicit `version: 1` |
| Specs | Story bag `{ "specs": ["<slug>", …] }` | legacy v1 (no `version` key) |
| Specs | Markdown files at Board and Story scope | none; Markdown need not carry a version |
| Comments | Story and Task bag `{ "comments": [ … ] }` | legacy v1 (no `version` key) |

**Existing unversioned built-in bags are legacy v1.** A future reader treats a bag without a `version` key as version 1. Rowbly adds no universal bag version: a bag gets a `version` key only when its Plugin introduces an incompatible shape (§3.4).

JSON Plugin files may carry their own `version`, as Epic files do. Markdown files need not. A Markdown format change, if it is ever needed, is signalled by the Plugin itself (a new file name, or front matter), never by core.

### 3.3 What an older Rowbly does with newer data

**Older Rowbly does not overwrite future Plugin data** that it can recognize as future data. Today that holds in these cases:

| Data an older Rowbly finds | What it does |
| --- | --- |
| A bag of a Plugin it does not have, or that is off | Keeps it unchanged through every core operation, and through cascaded moves and deletions. |
| A file of a Plugin it does not have, or that is off | Keeps it. Deletes it only with its whole Story or Board folder. |
| A bag of its own Plugin that does not parse (invalid) | Keeps it through unrelated edits. Display shows it as unavailable. Mutations of that data (`requireBag`) fail with `DATA_INTEGRITY` until the person repairs or resets it. Doctor reports it. |
| An Epic file with `version` greater than 1 | Shows the Epic as unavailable, reports `EPICS_UNSUPPORTED_VERSION`, and never rewrites the file. |
| A core record whose `version` is not 1 | Does not parse it (`SCHEMA_INVALID`) and does not write it. |

**The gap: valid-looking future bags.** The built-in bag schemas are ordinary Zod objects, which drop keys they do not know. If a newer Rowbly writes `{ "version": 2, "comments": [ … ], "pinned": "c1" }` and the array still parses as version 1, an older Rowbly reads the bag as *valid*. When it next writes that bag for its own reason (adding a Comment, say), it writes only `{ "comments": [ … ] }`, and `version` and `pinned` are lost. Core's preservation (ADR-0020 §3) covers unrelated edits, not the owning Plugin's own rewrite. §3.4 therefore treats every new field that an older Rowbly must not lose as an incompatible change.

### 3.4 Changing a format

- **Additive and losable.** A new optional field that an older Rowbly may drop on its own rewrite without harm needs no new version. The release notes say that older releases drop it.
- **Incompatible.** Any other change: a new field that must survive, a changed meaning, a renamed or removed field, a changed type. It follows all of these rules:
  1. **Old readers must refuse the new shape.** Every Rowbly release that is still in use must see the new bag as invalid or unsupported, never as valid. Either:
     - *reader first*: release a reader that knows the `version` key, and treats an unknown version as unsupported, at least one release before any writer emits the new version; or
     - *fail the old schema*: give the new shape a form that the legacy v1 schema rejects, for example a changed type for an existing key (`"comments": { "items": [ … ] }` instead of an array). It is then invalid to older releases, which keep it and refuse to change it.

     Because no shipped bag reader looks at `version` today, the first versioned bag of a Built-in Plugin must use "fail the old schema", or wait for "reader first".
  2. **Keep recognizing the old shape.** The new reader accepts every supported old shape (legacy v1 included) until an explicit migration converts it. An ordinary mutation of a record still in the old shape writes the old shape, so an older Rowbly that shares the Data Root through Git can keep working on records that are not migrated. A feature that needs the new shape fails with a hint to run the migration.
  3. **Unknown versions are unsupported.** A bag that declares a version the reader does not know is unsupported: shown as unavailable, kept unchanged, refused by mutations with `DATA_INTEGRITY`, and reported by doctor. It is never parsed as an older version and never cleared.

### 3.5 Migration rules

A migration converts stored Plugin Data from one supported shape to another. Rowbly has none today.

- **Never inferred.** A migration never starts because `readBag` returned `undefined`, because a bag is invalid, or because a parse failed. It acts only on bags it recognizes positively as a supported old shape, through `inspectBag` or the raw bag, with each old shape handled explicitly.
- **Never automatic.** Nothing migrates at startup, while reading, or during doctor analysis. A migration runs only when a person asks: an explicit doctor fix (`doctor --fix`, which shows the fix first) or a Plugin migration command, for example `rowbly comments migrate`.
- **One operation.** It runs as one operation through `ops.run`. It therefore holds the Data Root lock from planning to commit and commits through the transaction journal, so it completes entirely or not at all, also after a crash (ADR-0019).
- **Dry run.** It can report every planned change without writing (`--dry-run` for a command; doctor's report for a fix).
- **Idempotent.** Running it again on migrated data plans no changes. An interrupted run that recovery rolled back can simply run again.
- **Leaves the rest alone.** Invalid and unsupported bags are reported, not changed. Bags and files of other Plugins, including Plugins that are off, are not touched. Unknown keys of a bag it does convert are carried over, or the migration refuses that bag; they are never silently dropped.
- **Backups.** The journal guarantees all-or-nothing, not undo. The migration's help and dry-run output tell the person to commit or back up the Data Root first.

### 3.6 Worked example: Comments v1 to a hypothetical v2

Suppose Comments adds a pinned Comment per Thread, and the pin must not be lost.

Old bag, legacy v1 (today's shape, no `version`):

```json
"plugins": {
  "comments": {
    "comments": [
      { "id": "c1", "author": "ana", "body": "Looks good",
        "createdAt": "2026-10-01T09:00:00.000Z", "updatedAt": "2026-10-01T09:00:00.000Z" }
    ]
  }
}
```

New bag, v2. `comments` changes from an array to an object, so the legacy v1 schema rejects it ("fail the old schema", §3.4):

```json
"plugins": {
  "comments": {
    "version": 2,
    "comments": {
      "items": [
        {
          "id": "c1",
          "author": "ana",
          "body": "Looks good",
          "createdAt": "2026-10-01T09:00:00.000Z",
          "updatedAt": "2026-10-01T09:00:00.000Z"
        }
      ],
      "pinned": "c1"
    }
  }
}
```

| Reader | Bag | Result |
| --- | --- | --- |
| Older Rowbly (v1 reader) | v1 | Valid. Works as today. |
| Older Rowbly (v1 reader) | v2 | Invalid: the Thread shows as unavailable, unrelated edits keep the bag, adding a Comment fails with `DATA_INTEGRITY`, doctor reports it. Nothing is lost. |
| Newer Rowbly (v1 + v2 reader) | v1 | Valid as legacy v1. Ordinary edits keep it in v1. Pinning fails with a hint to run `rowbly comments migrate`. |
| Newer Rowbly (v1 + v2 reader) | v2 | Valid. |
| Newer Rowbly (v1 + v2 reader) | `{ "version": 3, … }` | Unsupported: unavailable, kept, mutations refused, doctor reports it. |
| Any Rowbly, Comments off | any | Kept unchanged. |

`rowbly comments migrate --dry-run` lists each Story and Task whose Thread is v1 and would become v2. Without `--dry-run`, it rewrites them in one operation. A second run plans nothing.

### 3.7 Tests required for the first real migration

The first change that introduces a new storage version must ship with tests for each of these:

1. **Old reader, new data:** the previous release's schema sees the new shape as invalid (or unsupported), and an unrelated core edit plus a refused own mutation leave it unchanged.
2. **Unsupported version:** a bag or file with an unknown higher version is unavailable, unchanged after every mutation, and reported by doctor.
3. **Old shape still read:** legacy v1 data is displayed and editable by the new release, and an ordinary edit keeps it in the old shape.
4. **Dry run writes nothing:** the Data Root is byte-identical after a dry run.
5. **Idempotent:** a second run plans no changes.
6. **All or nothing:** a migration rejected before save (a throwing step or a rejecting guard part-way through the plan) leaves every record unchanged; a migration killed after the commit point recovers to the complete new data, and one killed before it to the complete old data.
7. **No automatic writes:** starting the CLI and the TUI, reading, and doctor without `--fix` leave old-shape data byte-identical.
8. **Scope:** invalid bags, unknown keys, and bags and files of other Plugins (including Plugins that are off) are unchanged or carried over, never dropped.
9. **Keys:** the bag keys `epic`, `specs` and `comments` and the Plugin IDs are unchanged.

## 4. Dependencies between Plugins: deferred

Plugins cannot depend on one another today, and none needs to. Plugins run in registry order, and a Plugin that fails to load affects no other Plugin. This stays as it is until a Plugin requires another one. The design made then must decide:

- **Required versus optional** dependencies, and how a Plugin declares each.
- **Versions:** which API or package version of the dependency it needs (§2), checked before activation.
- **Missing, off or incompatible:** a missing or incompatible required dependency makes the dependent Plugin fail to load, with a reason that names the chain. An optional one that is absent is not an error. Rowbly never turns a dependency on or rewrites configuration by itself, unless a later decision chooses that policy explicitly.
- **Cycles:** rejected before activation, naming every Plugin in the cycle.
- **Failure propagation:** a dependency that fails at any load step (settings, `start`, CLI or TUI staging, a late name clash, a TUI import failure) makes its dependents fail too. `markFailed` then has to propagate.
- **Order:** a stable topological order that keeps registry order for Plugins that are not related.
- **Name clashes:** how dependency order interacts with the first-registered winner of command, flag, key and replacement clashes (ADR-0020 §8).
- **Turning off:** what turning off a Plugin that others require does.

Interoperation goes through the Plugin API (operations and hooks). A Plugin never imports another Plugin's folder. Typed cross-Plugin contracts are optional and need a real consumer.

**Tests when scheduled:** missing, off and incompatible required dependencies; an absent optional dependency; a cycle; unchanged order for independent Plugins; a dependency that fails late; a dependent when its dependency is turned off; errors that name the chain; configuration left unchanged.

## 5. What is not built

- No migration engine, migration lifecycle hook or universal bag version.
- No API version field, version check or semver-range engine (until §2.2 is scheduled).
- No dependency declarations or dependency graph (until §4 is scheduled).
- No automatic or silent migration, at startup or by doctor.
