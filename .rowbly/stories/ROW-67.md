---
title: Restart the factory daemon automatically after a crash
stage: IN_REVIEW
position: 1
worktree: /home/sgolovine/Projects/rowbly-worktrees/ROW-67
pull_request: https://github.com/sgolovine/rowbly/pull/232
---

## Goal

When the factory daemon crashes, it starts again automatically, so that the factory continues without a person. After 5 crashes in a row, the factory stays stopped and tells the user.

## Scope

In scope:

- Run the daemon under a small watchdog process. `launchDaemon` in `src/services/factory/factory-launch.ts` starts the watchdog detached (a new hidden command `rowbly factory watchdog`, with the same `--max-workers` and `--adopt-external` options as `factory run`). The watchdog starts `rowbly factory run` as its child and watches the exit.
- A crash is an exit that the daemon did not request: a non-zero exit code or a signal, without a stop command. A normal stop, `factory stop`, `factory restart`, a clean exit (exit code 0, which includes the `already-running` result of `factory run`) do not cause an automatic restart. On a clean exit, the watchdog also exits.
- After a crash, the watchdog waits and then starts the daemon again. The wait increases with each crash in a row: 1 s, 2 s, 4 s, 8 s, 16 s.
- The count of crashes in a row goes back to 0 when a daemon stays up for a stable period of 5 minutes.
- After 5 crashes in a row, the watchdog does not start the daemon again and exits. The factory phase is `failed`. The factory shows an attention entry with the last exit code or signal and the path of the last log.
- Each restart goes through the usual start path of `factory run`: the owner probe, the recovery after owner death and the release of ownership. A restart does not take over a live or uncertain owner. If the owner is alive or uncertain before a restart, the watchdog does not start a daemon. It records the problem and exits.
- `rowbly factory status` (and `--json`) and the TUI factory screen show the restart count and the time of the last crash.
- A manual `rowbly factory start` after the `failed` phase sets the count to 0.
- A `factory stop` during a back-off wait cancels the restart and stops the watchdog.

Not in scope:

- Settings for the back-off, the crash limit or the stable period in `.rowbly/factory.json`. They are constants.
- A restart of the factory after a reboot of the machine, or a system service (systemd, launchd).
- A restart of the watchdog itself if the watchdog dies.

## Acceptance criteria

- [ ] A daemon that crashes once starts again after the back-off, and recovery marks its active runs as interrupted.
- [ ] A daemon that crashes 5 times in a row stays stopped, the phase is `failed`, and an attention entry shows the last exit code or signal and the log path.
- [ ] A daemon that stays up for the stable period sets the count to 0. (A test can use a shorter period through an injected value.)
- [ ] `factory stop` and a clean exit (code 0) do not cause a restart, and the watchdog process exits.
- [ ] A stop during a back-off wait cancels the restart, and no daemon starts after the stop.
- [ ] A restart never starts a second daemon while an owner is alive or uncertain.
- [ ] `rowbly --json factory status` has the restart count and the time of the last crash. The TUI factory screen shows them.
- [ ] `factory start` after the `failed` phase sets the count to 0 and starts the daemon.
- [ ] The watchdog does not load Pi. A test in `src/services/pi-runtime/import-boundary.test.ts` (or an equivalent test) examines this.
- [ ] Tests use the faux provider and a fake daemon entry that crashes. No test runs a real Pi model.
- [ ] `docs/architecture/native-factory/recovery.md` and `runtime-and-locks.md` describe the automatic restart, in STE.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build` pass.

## Technical notes

Now nothing restarts the daemon. `launchDaemon` spawns the daemon detached and calls `unref()`, and the CLI process stops. Only a later `factory start` launches a new daemon (`startFactory` in `src/services/factory/factory.ts`).

Files and modules:

- `src/services/factory/factory-launch.ts`: `daemonArgs` builds `factory watchdog ...` in place of `factory run ...`. The watchdog builds the `factory run` arguments for its child from the same launch data (`execPath`, `execArgv`, entry). Keep `daemonExecArgv`.
- New service `src/services/factory-watchdog/` with a test next to it: the pure parts. The crash classification (exit code and signal), the back-off for a crash count, the stable-period reset, and the read and write of the watchdog state file. The service does not own process handlers, and does not print or exit.
- The watchdog process loop (spawn the child, handle `exit`, `SIGTERM`, `SIGINT`, timers) goes in `src/commands/factory-runner/` next to `factory-runner.ts`, because commands own process signals there. Register the hidden `watchdog` command in `src/commands/factory/factory.ts` like `run`.
- State file: `.rowbly/runtime/watchdog.json` (mode 0600, written with `writeFileAtomic` through `runtimePath`). Keys: `version`, `pid`, process identity (reuse `newOwner`/`probeOwner` data from `factory-ownership` to identify the watchdog process), `phase` (`running` | `backoff` | `failed` | `stopped`), `crashCount`, `lastCrashAt`, `lastExit` (code or signal), `lastLog`. `.rowbly/runtime/` is already ignored. Do not commit it.
- Each daemon start of the watchdog writes a new log under `.rowbly/runtime/logs/`, as `launchDaemon` does now. `lastLog` is that path.
- `getFactoryStatus` in `src/services/factory/factory.ts` reads `watchdog.json` and adds `restarts` (crash count) and `lastCrashAt` to `FactoryStatus`. When the watchdog phase is `failed` and no owner is live, the status phase is `failed` with an attention entry, key `watchdog:crash-limit`. The daemon is not running, so this entry is not dismissible through the daemon. The next `factory start` clears it.
- Stop: `stopFactory` must also stop a watchdog in `backoff`. If no owner is live but `watchdog.json` shows a live watchdog (verified with the process identity), send `SIGTERM` to the watchdog pid and wait until it exits. A watchdog that gets `SIGTERM` cancels its timer, does not start a daemon, writes phase `stopped` and exits. When a live daemon gets a stop command, it exits with code 0, so the watchdog exits too. No orphan watchdog stays.
- `startFactory`: if a live watchdog exists (in `backoff`), do not start a second watchdog. Wait for its daemon as now. If the watchdog phase is `failed` or no watchdog is live, reset the count to 0 and launch a new watchdog.
- `waitForReady` uses the launch state (`childError`, `exited`) of the spawned process. The spawned process is now the watchdog. Keep the "exited before ready" error for a watchdog that exits before ready (for example after the crash limit or a clean exit of the daemon).
- Ownership: the daemon (child) stays the owner in `factory.lock`. The watchdog never takes ownership. Before each restart, the watchdog reads the owner and calls `probeOwner`. It starts a child only if there is no owner or the owner is `dead`. The child then does the usual recovery in `runFactoryForeground`.
- TUI: `src/tui/screens/factory/factory-status.ts` (`factoryState`, `factoryProblems`) shows the restart count and the last crash time, and the `watchdog:crash-limit` problem when the phase is `failed`. Read the `rowbly-tui-design` skill first. Do not write TUI tests.
- Pi boundary: the watchdog command and service must not import `src/services/pi-runtime/` or `@earendil-works/pi-coding-agent`.
- Tests: a fake daemon entry (a small `.mjs` file, as in `src/services/factory/factory.test.ts`) that exits with a non-zero code. Inject short back-off and stable-period values in tests through function parameters, not through a production flag.
- Respect the lock order rule: never take the Project write lock while you hold the state lock.

## Assumptions

- The back-off values (1, 2, 4, 8, 16 s), the crash limit (5) and the stable period (5 min) are constants, not settings in `.rowbly/factory.json`. Reason: smallest scope. The Story gives these values as defaults, and no user asked for settings.
- The watchdog is a hidden `rowbly factory watchdog` command that the same executable runs. Reason: `launchDaemon` already starts the executable with a hidden `factory run` command, and the same launch data works for the watchdog.
- The watchdog state is in `.rowbly/runtime/watchdog.json`, separate from `status.json`. Reason: the daemon writes `status.json` and a crashed daemon leaves it old. A separate file prevents two writers on one file.
- A stop during a back-off sends `SIGTERM` to the watchdog pid after a process identity check. Reason: no daemon is live to receive a control command, and the identity check prevents a signal to a different process with a reused pid.
- An exit with code 0 is always a clean exit, also for `already-running`. Reason: `factory run` returns code 0 for a requested stop and for `already-running`, and a restart in these cases is not necessary.
- The crash-limit attention entry is not dismissible. The next `factory start` clears it. Reason: the dismiss command needs a live daemon.
- If the watchdog itself dies, nothing restarts it. Reason: smallest scope. The daemon then works as now, without a watchdog.
