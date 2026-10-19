# ADR-0021: Plugins own their data formats; compatibility is a policy, not an engine

**Status:** Accepted. The policy is in effect; the engines and loaders it defers are not built.

Rowbly persists three kinds of Plugin Data with no stated rules for change: Epic files carry `version: 1`, while the Epics, Specs and Comments bags carry no version. The Plugin API has no version, and the application version and record `version` do not identify it. ADR-0020 §3 defines the bag kinds (absent, valid, invalid, unsupported) and reserves "unsupported" for bags that carry a version, but it left the policy for versions and migrations to this ADR. The policy text is in [compatibility.md](../../plugins/compatibility.md), and the trust model it relies on in [trust.md](../../plugins/trust.md).

We decided:

- **Three versions stay distinct.** The API version (the Plugin API contract), the package version (a release of Rowbly or of a Plugin package) and the storage version (the shape of persisted data) change for different reasons. None stands in for another.
- **The Plugin API is internal and unreleased.** Built-in Plugins compile with the host, so the API has no version and makes no promise. Before any external package loads, Rowbly adopts one integer API major version, checks it before a Plugin's settings, staging or `start`, and reports the required and actual versions. Ranges and a semver engine wait until a real Plugin needs them.
- **Each Plugin owns its bag and file formats.** Core keeps unknown, off and invalid data opaque. The current bag keys `epic`, `specs` and `comments` stay.
- **Existing unversioned built-in bags are legacy v1.** No universal bag version is added. A bag gets a `version` key only when its Plugin makes an incompatible change. JSON Plugin files may carry their own version; Markdown need not.
- **An incompatible shape must be refused by older readers.** Today's bag schemas drop unknown keys, so an older Rowbly would read a versioned bag whose old keys still parse as valid and drop the new keys on its own rewrite. The new shape must therefore either fail the legacy schema, or follow a release whose reader already treats unknown versions as unsupported. The new reader keeps recognizing every supported old shape until an explicit migration.
- **Migration is explicit.** It is never inferred from `readBag` returning `undefined` or from a parse failure, and never automatic at startup, on read, or during doctor analysis. It is an explicit doctor fix or a Plugin migration command. It runs as one operation, so it uses the Data Root lock and the transaction journal (ADR-0019). It is dry-run-capable and idempotent.
- **Plugin dependencies, the external loader and the Git capabilities are deferred** until a dependent Plugin, an external package or the Git Plugin is scheduled. Their requirements are recorded in [compatibility.md](../../plugins/compatibility.md) §4, [trust.md](../../plugins/trust.md) §3 and ADR-0016's status note.

We rejected:

- a migration engine or migration lifecycle hook, and a universal version on every bag, because no current format needs to change and one explicit migration command is enough for the first real migration;
- automatic migration at startup or by doctor, because it would rewrite shared, committed data without a person's decision, and could destroy data that an older teammate's Rowbly still reads;
- treating an unknown version or an invalid bag as an older version or as empty;
- a version-range engine before ranges are needed.
