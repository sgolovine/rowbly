# Git

Git reacts to saved Operations and commits their Rowbly-managed files. Automatic Merge Conflict Resolution independently fetches, reconciles and pushes to the configured upstream. Its personal preferences live in Local State.

**Automatic Commit**:
A Git commit with the message `chore: update Rowbly data`, made after a saved Operation or when its interval is due.
_Avoid_: snapshot

**Commit Frequency**:
Either after each saved change or after a chosen number of seconds, when changes are pending.
_Avoid_: cadence

**Commit Author**:
The Git name and email used for an Automatic Commit; unset values come from Git configuration.
_Avoid_: committer identity


**Automatic Merge Conflict Resolution**:
An independently enabled, interval or on-demand synchronization of the current branch with its configured upstream, retaining conflicting Rowbly alternatives as committed evidence before pushing a valid result.

**Merge Evidence**:
Content-addressed files under `plugins/git/merge-evidence/` retaining the base, exact alternatives, provenance, remapping and repair decisions of synchronization.

**Sync**: the Git Plugin's header Action (`S`). Commits pending Rowbly data/configuration before
fetching, reconciles while rebasing onto the configured upstream, publishes recoverably and pushes.
Independent of both automatic preferences; no empty capture or force-push. Scheduled and CLI sync
retain merge semantics. Success belongs to the manual run that actually pushed (ADR-0035).
