# Git

Git reacts to saved Operations and commits their Rowbly-managed files, and its Sync Action sends them to the branch's upstream. Its personal preferences live in Local State.

**Automatic Commit**:
A Git commit with the message `chore: update Rowbly data`, made after a saved Operation or when its interval is due.
_Avoid_: snapshot

**Commit Frequency**:
Either after each saved change or after a chosen number of seconds, when changes are pending.
_Avoid_: cadence

**Commit Author**:
The Git name and email used for an Automatic Commit; unset values come from Git configuration.
_Avoid_: committer identity

**Sync**:
The Git Plugin's Action (key `S`) that commits pending Rowbly data, rebases onto the current branch's upstream and pushes, never forced.
_Avoid_: sync button
