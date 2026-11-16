---
title: Add the placement setting and host worker slots
stage: DONE
position: 14
uid: 869fe931-83fe-422c-8bdc-f6649b6e45d7
dependsOn:
  - ROW-83
  - ROW-84
createdAt: 2026-11-16T19:45:09.575Z
updatedAt: 2026-11-16T21:12:33.482Z
worktree: /home/sgolovine/Projects/rowbly-worktrees/ROW-95
pull_request: https://github.com/sgolovine/rowbly/pull/276
---

## Goal

The manager places each worker on a machine: the main machine (`local`) or a worker host. The user selects the placement policy in the factory settings. This Story adds the setting, the worker slots of each host, a pure placement function and the use of that function in `start_worker`. It does not send work to a remote host.

Read the Spec `remote-worker-hosts`, section "Placement".

## Scope

In scope:

- A `placement` key in the `factory` section of `.rowbly/rowbly.config.json`: `prefer-local` (default), `most-free` or `prefer-remote`.
  - `getFactorySettings` gives `prefer-local` when the key is not in the file. A write does not add the default to the file. A write keeps the other keys.
  - Another value makes the settings invalid (`ValidationError`, and `validFactorySettings` gives `false`, so `rowbly doctor` reports it).
  - `rowbly factory configure --placement <policy>` sets the key. An unknown policy gives `VALIDATION`.
- Worker slots for each host. A new pure module computes, for each host, `{ id, state, max, used, free }`:
  - `local`: `max` is the worker limit of the manager (`deps.maxWorkers ?? settings.maxWorkers`). It is always `connected`.
  - Each worker host from a new optional manager dependency `workerHosts` (see "Technical notes"): `max` is the `maxWorkers` of the host.
  - `used` is the number of active worker entries of the manager (`ActiveWorker.host`) on that host.
- A pure placement function. Inputs: the policy, the slots of each host, the state of each host, the providers of each host, the provider of the worker model, the Story facts (the host of its last worker Thread, and for the old worktree: pushed or not, clean or not) and an optional requested host. Output: a host id, or no host with a reason.
- `start_worker` accepts an optional `host` (a string). Without a host, the manager uses the placement function. With a host, the manager uses that host only if the placement rules permit it.
- `createWorkerThread` writes the placed host to the Thread (`host`), and the active entry gets the same host.
- The policy limit (`maxActive` of `scan`) becomes the sum of `max` of all hosts that can take work. With no worker hosts, it is `maxWorkers`, as now.
- The supervisor digest (`buildDigest` in `src/services/factory-manager/supervisor-loop.ts`) and `factory_snapshot` (`buildSnapshot` in `manager-status.ts`) get a `hosts` list with the slots of each host. Thus `status.json` also gets the list.
- Documentation in STE: the `placement` key in `docs/architecture/native-factory/pi-runtime-and-auth.md` and `runtime-and-locks.md`, `--placement` in `docs/architecture/native-factory/controls.md` and `docs/architecture/cli.md`, and the `host` input of `start_worker` and the placement rules where the supervisor tools are documented.

Not in scope:

- The dispatch to a remote host (ROW-96).
- The read of the host registry, the hosts that are on for the Project (ROW-88), the host states and heartbeats (ROW-97) and the providers of a host (ROW-87). Production gives no worker hosts to the manager in this Story.
- The control in the TUI Settings (ROW-103).
- `skills/rowbly-reference.md` (ROW-105 documents the placement for users).

## Placement rules

The function applies these rules in this order:

1. A host is eligible only if its state is `connected`, it has a free slot, and it has the provider of the worker model. `local` always has the provider. A remote host without a known provider list, or a worker model without a known provider, is not eligible.
2. Unpushed-work rule: when the Story has a local worktree with commits that are not on `origin`, or with uncommitted changes, only `local` is permitted.
3. Affinity: when the last worker Thread of the Story ran on host H, and H is eligible, the Story goes to H. When H is not eligible, the Story can go to a different host only when the old worktree is known to be pushed and clean. Otherwise there is no host, with a reason, and the Story waits.
4. Policy, for the other hosts that are eligible:
   - `prefer-local`: `local` first, then the worker host with the most free slots.
   - `most-free`: the host with the most free slots. A tie goes to `local`.
   - `prefer-remote`: the worker host with the most free slots first, then `local`.
   - A tie between worker hosts goes to the first host in the order of the input list.
5. A requested host must be eligible and must agree with rules 2 and 3. Otherwise the request fails with the reason. The policy does not apply to a requested host.

## Acceptance criteria

- [ ] With no worker hosts, the behavior is the same as now: each worker Thread gets `host: "local"`, the worker limit is `maxWorkers`, and the existing factory manager tests pass with no change of expectations except the new `hosts` keys.
- [ ] `getFactorySettings` gives `placement: "prefer-local"` for a config without the key. `updateFactorySettings({ placement: "most-free" })` writes the key and keeps the other keys of the `factory` section and of the config. A test examines this.
- [ ] A config with `placement: "random"` gives a `ValidationError` from `getFactorySettings`, and `validFactorySettings` gives `false`. A test examines this.
- [ ] `rowbly factory configure --placement most-free --json` writes the key. `--placement random` gives `VALIDATION` and the config does not change. A CLI test examines this.
- [ ] Pure tests of the placement function cover: each of the three policies; a tie in `most-free` (goes to `local`); a tie between two worker hosts (input order); a host with no free slot; a host that is `disconnected`; a host without the provider of the worker model; affinity to a host with a free slot; affinity to a full host with a pushed and clean worktree (moves) and with an unknown or dirty worktree (no host, with a reason); the unpushed-work rule (only `local`, also with `prefer-remote`); a requested host that is permitted and one that is refused.
- [ ] A manager test with an injected `workerHosts` dependency shows a `hosts` list in `factory_snapshot` and in the digest, with `id`, `state`, `max`, `used` and `free` for `local` and each host.
- [ ] `start_worker` with `host: "local"` works as without a host. `start_worker` with an unknown host, or with a host that the rules refuse, gives a `ConflictError` with the reason and creates no Thread. A manager test examines this.
- [ ] When the placement gives a worker host, `start_worker` gives a `ConflictError` ("Remote dispatch is not available") and creates no Thread, because the dispatch comes in ROW-96. A manager test examines this.
- [ ] The placement module and the slot module do not import Pi, SSH or `child_process`. The Git facts of the worktree come from a separate function that a test can replace.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build` pass.

## Technical notes

- Settings: `src/services/factory-settings/factory-settings.ts` (`FactorySettings`, `validSettings`, `withDefaults`, `writeSettings`, `ConfigureInput`, `configureFactory`). Put the policy type, the list of the policies and its validation in a new file, for example `factory-settings/placement-settings.ts`, in the same way as `git-settings.ts`. Give the default in `withDefaults`, not in `storedSettings`, so that a write does not add it.
- CLI: the `factory configure` command in `src/commands/factory/`. Keep the command thin. `--placement` alone must not load `agent-auth` if the other flags do not need it; follow the current pattern of `--max-workers`.
- Placement: a new pure module, for example `src/services/factory-manager/placement.ts` (or a new service folder `src/services/worker-placement/`) with a test next to it. No I/O.
- Manager dependency: add `workerHosts?: () => Promise<readonly WorkerHostView[]>` to `FactoryDependencies` in `src/services/factory-manager/manager-state.ts`. A `WorkerHostView` has `id`, `maxWorkers`, `state` and `providers`. Without the dependency, the list is empty. Later Stories (ROW-88, ROW-96, ROW-97, ROW-87) give the real list from the registry (`listHosts` in `src/services/host/host.ts`), the Project use and the host states.
- Story facts: `src/services/worker-worktree/worker-worktree.ts` has the worktree path rule (`worktreePath`). Add an exported function that reads, for an existing local worktree, `git status --porcelain` (dirty) and `git rev-list --count HEAD --not --remotes=origin` (unpushed). A worktree that does not exist has no facts. Use `execFile`, never a shell string. Give this function to the manager through a dependency or a parameter, so that tests can give fakes. Read the facts only when the Story has a local worktree and a worker host is in the list; with no worker hosts, do not run Git.
- The host of the last worker Thread of the Story: `listThreads({ role: "worker" })` in `src/services/thread/thread-list.ts`, `ThreadRecord.host` (`LOCAL_HOST` when absent).
- Reservation: `src/services/factory-manager/worker-reservation.ts` (`ReserveWorkerInput`, `assertSlotAvailable`, `createWorkerThread`, `startWorkerTask`). Replace the single `limit` check with the placement result. Keep the order of the checks: a repeated `requestId` still gives the prior Thread first.
- Tool schema: `start_worker` in `src/services/factory-manager/supervisor-tools.ts`. Add `host: z.string().min(1).max(64).optional()`, and add the placement to the tool description in a short form.
- Limit: `refreshSettings` in `supervisor-steps.ts` and `recoverAndConfigure` in `factory-manager.ts` set `limit`. `scan` in `manager-status.ts` uses it as `maxActive`. Keep `limit` as the local limit, and give `scan` the total of the hosts that can take work.
- Digest and snapshot: add `hosts` to the input of `supervisorDigest` in `buildDigest` and to the result of `buildSnapshot`. The digest bounds each list to twelve items.
- The supervisor prompt `src/config/prompts/SUPERVISOR.md` can get one short sentence about `host`. Do not build a message outside `src/services/messages/messages.ts`.
- Rules: the services do not import `commander`, `ink` or `react`. Do not load Pi in the settings, placement or status paths. Never take the Project write lock while you hold the state lock. Read the `rowbly-code-style` skill.

## Assumptions

- Production gives no worker hosts to the manager in this Story. Reason: the record of the hosts that are on for the Project (ROW-88), the host states (ROW-97) and the providers of a host (ROW-87) do not exist yet, and the dispatch (ROW-96) is not in scope. An injected `workerHosts` dependency lets the tests cover the placement. This also satisfies "with no worker hosts, the behavior is the same as now".
- A placement on a worker host fails with "Remote dispatch is not available" and creates no Thread. Reason: without ROW-96, a remote Thread would run on the main machine, which is wrong.
- A remote host without a known provider list, and a worker model without a known provider (the default Pi model), cannot go to a worker host. Reason: the Spec requires the provider on the host, and an unknown value must not start work that fails.
- A remote worktree whose pushed and clean state is not known blocks a move to a different host. Reason: the Spec permits a move only when the branch is pushed and the old worktree is clean. The host agent gives these facts in a later Story.
- "Unpushed" means commits in the worktree that are not on any `origin` remote branch (`git rev-list HEAD --not --remotes=origin`). Reason: a simple check that agrees with "local commits that are not pushed" and does not need an upstream branch.
- A tie between two worker hosts goes to the first host in the input order (the order of `~/.rowblyrc.json`). Reason: the Spec gives only the tie rule for the main machine; a stable order makes the tests deterministic.
- `prefer-local` and `prefer-remote` select, among the worker hosts, the one with the most free slots. Reason: the Spec does not give an order between worker hosts; this is the same rule as `most-free`.
- The `hosts` list in `status.json` has `id`, `state`, `max`, `used` and `free` only. Reason: `lastSeenAt` and the latency come with the heartbeat in ROW-97.
- `rowbly factory configure --placement` is in scope. Reason: the Story makes a user setting, and the TUI control comes later (ROW-103); the CLI is the smallest way to set it without a hand edit.
- The policy limit is the sum of the slots of the hosts that can take work, and `limit` stays the local limit. Reason: the policy must not stop at `maxWorkers` when a worker host has free slots, and the local limit stays `maxWorkers`.
