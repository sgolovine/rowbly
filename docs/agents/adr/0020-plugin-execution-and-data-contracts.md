# ADR-0020: Plugin execution, data preservation and error contracts

**Status:** Accepted. Built. Amends [ADR-0012](0012-plugins-intercept-service-operations.md)'s error policy (§5). The [Plugin API reference](../../plugins/api.md) documents these contracts for Plugin authors.

ADR-0012 gives every operation one pipeline: replacement or core, then transforms, guards, save and reactions. It did not say what each stage may do. Before this decision, a transform could start another operation, and a guard could still write. A Plugin can change a snapshot's `before.key` and so redirect a deletion. A retained Change Set can be used after its stage has ended. An invalid bag looks the same as an absent one, so an ordinary edit can overwrite it. Every expected error a Plugin throws turns into `INTERNAL` with "turn it off" advice. This ADR fixes these contracts. ADR-0019 covers locking, the journal and storage identity.

**It amends ADR-0012's error policy** (§5). The rest of ADR-0012 stands.

## 1. Stages, capabilities and how they are enforced

**Stages.** These are the stages:

- `body`, `replacement`, `transform`, `guard`, `commit` and `reaction`, inside an operation;
- `doctor-check` and `doctor-fix`, in doctor;
- `command`, a CLI action;
- `screen`, which covers a Plugin's TUI screens, tabs, Board sections and Actions;
- `field`, a TUI form field provider;
- `filter`, which covers `filterStories` and TUI filter conversion and summaries;
- `row`, which covers `storyRows` and `taskRows`;
- `option-input`, the conversion of CLI options into Plugin input.

| Stage | Change Set access | Services | May start an operation |
| --- | --- | --- | --- |
| `body` (core or Plugin operation) | Writer | `PluginReadServices` | No |
| `replacement` | Writer, plus `core()`. No `result` before `core()` returns | `PluginReadServices` | No (`core()` is allowed, once: §2) |
| `transform` | Writer bound to the stage. Records are deeply readonly snapshots; change data through writer methods only | `PluginReadServices` | No |
| `guard` | `PluginChangeSetView`: deeply readonly, plus pending `readFile`. No writers, at compile time or at run time | `PluginReadServices` | No |
| `commit` | Internal. Holds the lock (ADR-0019) | — | — |
| `reaction` | `PluginChangeSetView` of the saved plan, frozen once and shared by every reaction | `PluginReadServices`, `warn` | No |
| `doctor-check` | — | `PluginReadServices`, `DoctorData` (including `local`) | No |
| `doctor-fix` | Writer (the doctor pass's pending Change Set) | `PluginReadServices` | No |
| `command` | — | `PluginServices` | Yes |
| `screen`, `field` | — | `PluginServices` | Yes |
| `filter`, `row`, `option-input` | — | `PluginServices` (reads only in practice) | No |

**Execution scope.** The runtime keeps an `AsyncLocalStorage<ExecutionScope>` store:

```ts
interface ExecutionScope {
  operationId: string;          // one per ops.run
  operation: string;            // e.g. 'stories.create'
  plugin: string | null;        // the Plugin whose callback runs; null for core
  stage: Stage;
  lock?: LockHandle;            // ADR-0019 §1: the held lock, reused by reads in this scope
  ended: boolean;               // set when the stage returns or times out
}
```

Every host-controlled callback runs inside `scope.run({ … }, fn)`. That includes hooks, bodies, doctor checks and fixes, commands, screens, fields, filters, rows and option input.

**No nested mutation.** A mutating entry point, either `ops.run` (core mutations) or `plugin.operation`, first reads the store. If a scope exists and its stage cannot start an operation (the "No" rows above), the entry point throws **before any read or write**:

```text
PluginError (INTERNAL, exit 1)
Plugin "<id>" tried to start <operation> during the <stage> of <outer operation>
details: { plugin, operation: <outer>, stage, nested: <operation> }
hint: change data through the Change Set your <stage> receives, not through services or operations
```

The same check runs in every writer method (`putStory`, `updateStory`, `writeFile`, …), so a captured writer is caught too. Reads stay allowed. A replacement's `core()` runs inside the same plan and is not an operation entry. The rule also covers `doctor-check`, `filter`, `row` and `option-input`. Those stages run inside a read scope or an operation that holds the lock (ADR-0019 §5). A mutation started from them would wait for the lock that its own caller holds. They are projections, and they never need to write.

A detached continuation keeps the store of the stage that started it. The rule therefore holds even after `ended` is set. A `setTimeout` inside a reaction that later calls `services.stories.update` is rejected. Unrelated work, such as a TUI Action that starts while a background reaction is pending, runs in its own scope and is not affected. A process-global flag is never used.

**Writers live as long as their stage.** Each writer handle is created for one callback invocation and carries that invocation's token. When the stage returns (or times out, §4), the token is revoked. A revoked handle throws `PluginError`: `Plugin "<id>" used its Change Set after its <stage> of <operation> ended`. The plan is not changed. The plan is sealed before guards run and again before commit. A sealed plan rejects every writer.

**Snapshots.** Plugins never receive the plan's records. Every record, change, list and `before`/`after` they read is a detached, deeply frozen copy (`structuredClone` plus a deep freeze). Accessors return the current snapshot, so later valid writes in the same stage are visible to it. Update callbacks (`updateStory(key, fn)`) receive a copy. A callback that changes its copy and then throws leaves the pending record as it was. `before` is always the original record. Guards share one frozen snapshot per seal. Reactions share one frozen post-save snapshot. The original storage identities stay private (ADR-0019 §7). Changing `before.key` in a snapshot cannot redirect a deletion. This is protection against accidental changes. It is not a security sandbox (§6).

**Capabilities.** `PluginServices` is the ordinary core service layer without `plugins` (no other Plugin's `context(id)`, no enable/disable), without `setup` and without doctor mutations. `PluginReadServices` is the read-only part of it: the list, get, effective-config and Board-resolution methods (see `src/services/plugins/types.ts`). Both are built **at run time** by `src/services/plugins/capabilities.ts`, as new objects that contain only the allowed methods. Narrowing the TypeScript type is not enough. `PluginContext.services` and `PluginCommandEnv.services` hold `PluginServices`. Hook contexts hold `PluginReadServices`. The editor lives only on `PluginCommandEnv.editText`. Hook contexts have neither `operation` nor `editText`.

**Pinned Plugins.** An operation pins its list of active Plugins when it starts. Reloading or disabling a Plugin later does not change the hooks that the running operation calls.

## 2. Repeated `core()` and replacements

- **Call once.** A replacement's `core()` runs the core body against the shared plan at most once. A second call throws an attributed `PluginError` (`Plugin "<id>" called core() twice in its replacement of <operation>`), and the operation saves nothing. Not calling `core()` is allowed.
- **Replacements are advanced.** Replacements stay a supported, tested, *advanced* capability. They move out of the beginner guide into an advanced section ([tutorial §11](../../plugins/writing-a-plugin.md#11-advanced-replacements), and the [reference](../../plugins/api.md#replacements)). That section covers what the result must be, error pass-through, the shared plan, ordering and not calling `core()` on purpose. No built-in uses a replacement, and they stay covered by fixtures.

## 3. Plugin Data: bags, forms and settings

**Bag kinds.** A Plugin's bag on a record (`plugins.<id>`) is one of four kinds:

- **absent**: the key is not there;
- **valid**: it parses with the Plugin's schema;
- **invalid**: it is present but does not parse;
- **unsupported**: it is present and declares a data version that this Rowbly does not know.

Unsupported is reserved for bags that carry their own version. No bag does that yet. Rowbly adds no universal bag version and no migration engine. Existing built-in bags have no version and are read as legacy v1 ([ADR-0021](0021-plugin-format-and-compatibility-policy.md) and [`docs/plugins/compatibility.md`](../../plugins/compatibility.md) set the policy). A parse failure never means "empty".

**Reading.**

- `inspectBag(record, schema)` returns the kind: `{ kind: 'absent' } | { kind: 'valid', value } | { kind: 'invalid', raw, issues }`. The field is named `kind`, not `state`, because "state" is an _Avoid_ word in `docs/agents/CONTEXT.md`.
- `readBag(record, schema)` stays tolerant, for display only. It returns `undefined` when the bag is absent **or** invalid, and its JSDoc says so.
- `requireBag(record, schema)` is for mutations of existing data. It returns `undefined` only when the bag is absent. For an invalid bag it throws `DataIntegrityError` (exit 6): `Plugin "<id>" data on <record> is not valid`. The error has `details: { plugin, path, issues }` and the hint `run \`rowbly doctor\`; fix or reset the value before changing it`.

Adding a Comment, and adding or removing a Spec link, use `requireBag`. They reject invalid existing data until the person chooses an explicit repair or reset.

**Preservation.** Core and unrelated edits keep a bag's raw value as it was when they do not change it. That covers invalid, unsupported and unknown bags, unknown keys inside a bag, and bags of Plugins that are off or unknown. Rowbly preserves the *meaning*. It does not preserve JSON whitespace or key order, which serialization normalizes today.

**Forms (the dirty contract).**

- A field provider contributes input only when one of its own fields changed. The comparison uses normalized values.
- `undefined` means "no change". Clearing is an explicit value that the Plugin defines, for example `{ epic: null }`, and only a deliberate action produces it.
- An unchanged provider, or one whose fields failed to load, never contributes input, so it can never clear stored data.
- A field whose stored bag is invalid shows as unavailable. Its value is kept unchanged, and a separate reset action is a dirty clear.

**Writing.**

- `writeBag<R extends Bagged>(record: R, bag: Record<string, unknown> | undefined): Omit<R, 'plugins'> & Bagged`. It never promises a narrowed `plugins` type after it clears or replaces the bag.
- `writeBag` on the root config is rejected at run time, before any save. The check is shape-based: the record has both `version` and `assignees`. It throws `PluginError`: `Plugin "<id>" cannot use writeBag on rowbly.config.json`, with the hint `change settings with changes.updateRootConfig and keep "enabled"`. ADR-0019 §6 check 9 is a second check at commit.
- Root settings change only through an explicit merge that keeps `enabled` and the entries of other Plugins:

  ```ts
  await changes.updateRootConfig((config) => ({
    ...config,
    plugins: { ...config.plugins, [id]: { ...newSettings, enabled: config.plugins?.[id]?.enabled } },
  }));
  ```

- A Plugin is turned on or off only through the plugins service. Board-settings writes are allowed only as documented settings. Settings stay separate from general bags.

**Bag-only changes.** A change that touches only a Plugin's bag on a Story, such as linking an Epic or Spec, bumps the Story's `updatedAt`. It does so only when the bag actually changes, and it uses the operation clock (`ctx.now()`). Writing back an equal bag is not a change.

**Comment bodies.** A Comment body keeps its raw text on both surfaces (CLI and TUI). Leading and trailing whitespace are not trimmed. The Comments service rejects a body that is empty or whitespace only, with `ValidationError`.

## 4. Results and reactions

- **Public results.** Hook `result` types are the operation's *public* results, the ones the service caller gets:
  - `fields.update` gives `CustomFieldDef[]`;
  - `boards.remove` and `context.clearUse` give `undefined`;
  - `plugins.enable` and `plugins.disable` give `{ id: string; enabled: boolean }`.

  Internal data such as `{ next, stripped }`, the data for refreshing the context, and the Local State left after a Board deletion travel in a private side channel and never reach `result`.
- **Pre-save events.** Transform and guard events receive `result`, the body or replacement result before transforms. Built-in transforms find the created Story through `result.key`. They no longer scan for "the first created Story".
- **Final results.** Results given to callers and to reactions are the final, post-transform values, read from the pending plan. Core records, Stage lists and Local State are re-read by the runner. A Plugin operation may pass a pure finalizer, `result(changes, bodyResult)`, that reads its own records from the plan.
- **Removed results.** If a transform removes the entity that the operation returns, the operation fails before save with an attributed `ConflictError`: `Plugin "<id>" removed <entity> that <operation> returns`. The error has `details: { plugin, operation, stage: 'transform' }`.
- **Reaction deadline.** Each reaction gets **5 s**. The value can be configured for tests through the runner options. On timeout Rowbly warns (`Plugin "<id>" did not finish reacting to <operation> within 5 s`), revokes the reaction's handles and continues with the later reactions. Nothing is rolled back, because the data is committed. A late rejection is swallowed and logged as a warning. The CLI waits for reactions (bounded by the deadline) and then exits 0. The TUI runs them in the background, in the order of the operations, without blocking the screen. A timeout cannot stop a synchronous loop or detached work (§6).

## 5. Expected errors keep their meaning: an amendment to ADR-0012

ADR-0012 says that "an error in a guard, a transform or a replacement fails the operation: nothing is saved, the command exits 1, and the error names the Plugin and says how to turn it off". **This ADR replaces that sentence with the table below.** Nothing is saved on a pre-save failure, and that part is unchanged. The rest of ADR-0012 stands.

| Thrown inside a host-controlled Plugin callback | Result |
| --- | --- |
| `UsageError`, `ValidationError`, `NotFoundError`, `ConflictError`, `DataIntegrityError` | The same class, code and exit code, with the same message, hint and `details.issues`. The framework adds `details.plugin`, `details.operation` (when there is one) and `details.stage`. Framework attribution wins over details that the Plugin supplied. The adapter throws a new instance of the same class, with `cause` set to the original. |
| A guard that returns `{ reject, hint, canForce? }` | `ConflictError` (exit 4) with `details: { plugin, operation, stage: 'guard', canForce? }`. `canForce` passes through, so the TUI can offer a forced retry. |
| A guard that throws an expected error | That error's code, attributed as above. |
| An unexpected throw (`TypeError`, `Error`, a thrown string, …) | `PluginError` (`INTERNAL`, exit 1), attributed, with the hint `turn it off with \`rowbly plugins disable <id>\``. When the thrown value was itself a Rowbly error, `details.cause` holds its code. |
| A core error from a replacement's `core()` | Passes through unchanged. |
| A `PluginError` that already carries `details.plugin` | Not wrapped again. |

One adapter, `invokePlugin({ plugin, operation?, stage }, fn)`, applies this table. It handles both synchronous throws and rejected promises. It wraps every host-controlled callback:

- hooks and replacements;
- Plugin operation bodies;
- CLI command actions;
- option-input conversion;
- `filterStories`;
- rows;
- doctor checks and fixes;
- TUI field providers, input conversion, filter conversion and filter summaries;
- Actions;
- reactions, where an error only warns.

React render errors are caught by the TUI error boundaries instead. Doctor finding JSON includes `details.plugin` explicitly. With `--json`, the error shape stays `{"error":{"code","message","details","hint"}}`.

A thrown doctor fix still aborts its current, unsaved pass. That part of ADR-0012 is kept.

## 6. Trust model

- Built-in Plugins are trusted code. The architecture import tests enforce conventions. They do not confine anything.
- Capabilities, frozen snapshots, stage-bound writers, the symlink policy (ADR-0019 §10) and cooperative timeouts guard against *accidental* misuse. They do not contain malicious code. The docs never describe them as a sandbox.
- A promise timeout cannot interrupt a synchronous loop or detached work. Wherever timeouts are documented, the docs say so.
- A trusted in-process loader for third-party Plugins may become a deliberate future policy (only if approved). Running untrusted code safely would need a separate design with a process boundary and a permission UI. That is out of scope.

## 7. API restraint

The order of work is:

1. typed input validation;
2. operation results;
3. dirty forms;
4. shared CLI parsing.

The declarative Story-field helper is considered only after those primitives are stable, and only if a re-measured example shows a meaningful reduction. Rowbly does not build a second workflow engine, an operation-schema registry, a typed route DSL or a family of general UI helpers.

**Verbs, layout and delete results stay as they are.** We keep:

- the published operation verbs: Comments `add/update/remove`, which ADR-0018 approved, and Epics/Specs `create/edit/delete`;
- the folder and file layout of each Built-in Plugin;
- each delete operation's result shape: Epics `{ id, storiesUnlinked }`, Specs a count, Comments `{ deleted }`.

The variation is deliberate. Docs and recorder tests match the current names. Renaming would touch every Built-in Plugin for no functional gain, and would change published CLI verbs and JSON output.

## 8. Late registration failure

A Plugin whose registration fails at any step (settings, `start`, CLI or TUI attachment, or a name clash found late) is skipped **as a whole**. Its data is kept. Name claims (commands, flags, keys, screens, Actions) are reconciled within one activation sequence. Claims made by a Plugin that failed later in the sequence are released before the next Plugin is checked. A later Plugin that was rejected *before* that failure is not retried in the same run. This is a deterministic, documented policy: the result depends only on registry order and the Data Root's configuration.
