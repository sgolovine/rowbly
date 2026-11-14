---
title: Restart the factory daemon automatically after a crash
stage: IN_REFINEMENT
position: 1
worktree: null
pull_request: null
---

## Goal

When the factory daemon crashes, it starts again automatically, so that the factory continues without a person. After 5 crashes in a row, the factory stays stopped and tells the user.

## Scope

- Run the daemon under a small watchdog process. `launchDaemon` in `src/services/factory/factory-launch.ts` starts the watchdog detached. The watchdog starts `rowbly factory run` as its child and watches the exit.
- A crash is an exit that the daemon did not request: a non-zero exit code or a signal, without a stop command. A normal stop, `factory stop`, `factory restart` and a clean exit do not cause an automatic restart.
- After a crash, the watchdog waits and then starts the daemon again. The wait increases with each crash in a row, for example 1 s, 2 s, 4 s, 8 s, 16 s.
- The count of crashes in a row goes back to 0 when a daemon stays up for a stable period, for example 5 minutes.
- After 5 crashes in a row, the watchdog does not start the daemon again. The factory phase is `failed`. The factory shows an attention entry with the last exit code or signal and the path of the last log.
- Each restart goes through the usual start path: the owner probe, the recovery after owner death and the release of ownership. A restart does not take over a live or uncertain owner.
- `rowbly factory status` and the TUI show the restart count and the time of the last crash.
- A manual `rowbly factory start` after the `failed` phase sets the count to 0.

## Acceptance criteria

- [ ] A daemon that crashes once starts again after the back-off, and recovery marks its active runs as interrupted.
- [ ] A daemon that crashes 5 times in a row stays stopped, the phase is `failed`, and an attention entry shows.
- [ ] A daemon that stays up for the stable period sets the count to 0.
- [ ] `factory stop` and a clean exit do not cause a restart.
- [ ] A stop during a back-off wait cancels the restart.
- [ ] A restart never starts a second daemon while an owner is alive or uncertain.
- [ ] The watchdog does not load Pi.
- [ ] Tests use the faux provider and a fake daemon that crashes. No test runs a real Pi model.
- [ ] `docs/architecture/native-factory/recovery.md` and `runtime-and-locks.md` describe the automatic restart, in STE.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build` pass.

## Technical notes

Now nothing restarts the daemon. `launchDaemon` spawns the daemon detached and calls `unref()`, and the CLI process stops. Only a later `factory start` launches a new daemon (`startFactory` in `src/services/factory/factory.ts`).
Decide if the back-off values, the crash limit and the stable period are settings in `.rowbly/factory.json` or constants. The default crash limit is 5.
Keep the watchdog state (count, last crash) in `.rowbly/runtime/`. Do not commit it.
Make sure that the watchdog itself does not stay as an orphan when the user stops the factory.
