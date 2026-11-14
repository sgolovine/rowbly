---
title: "Optional: move a stuck upstream Story out of Backlog automatically"
stage: IN_REFINEMENT
position: 2
worktree: null
pull_request: null
---

## Goal

As an option, the factory moves a stuck upstream Story out of Backlog, so that the upstream work starts without a person.

## Scope

- Add the factory setting `dependencies.pullUpstream` to `.rowbly/factory.json`. The default is `false`. Read and validate it in `factory-settings/`, as the other settings.
- When the setting is `true` and a blocked Story is in a work Stage, the manager moves each of its upstream Stories that are in the first Stage to the first work Stage. This includes indirect upstream Stories.
- The manager makes the move through the Story service under the Project write lock, and records it in the canonical commit of the factory with a clear message.
- The manager does not move a Story that is parked or in a hold Stage. The attention of ROW-63 stays for these Stories.
- `rowbly factory configure --pull-upstream on|off` changes the setting. Settings › AI shows it.

## Acceptance criteria

- [ ] With the setting `false`, nothing moves, and the attention of ROW-63 shows.
- [ ] With the setting `true`, ROW-05 in a work Stage and ROW-04 in Backlog: ROW-04 moves to the first work Stage, and then a worker starts for it.
- [ ] An indirect upstream Story in Backlog also moves.
- [ ] A move does not take the Project write lock while the manager holds the state lock.
- [ ] Tests use the faux provider. No test runs a real Pi model.
- [ ] `docs/architecture/native-factory/pi-runtime-and-auth.md` and `controls.md` describe the setting, in STE.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build` pass.

## Technical notes

Depends on ROW-63. Read the `story-dependencies` Spec.
This Story is optional. A move changes the board of the user, so the setting is off by default.
Obey the lock order rule of `AGENTS.md`: never take the Project write lock while you hold the state lock.
