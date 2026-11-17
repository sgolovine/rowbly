import type { Key } from "ink";
import type { Dispatch, SetStateAction } from "react";
import { type FactorySettings, updateFactorySettings } from "../../../../services/factory-settings/factory-settings.js";
import { placementChange } from "../../../../services/factory-settings/placement-settings.js";
import { addHost, updateHost } from "../../../../services/host/host.js";
import { checkHost, type HostCheck } from "../../../../services/host-check/host-check.js";
// `useHost` is a service, not a React hook. The other name keeps the hook rules of Biome off it.
import { useHost as turnOnHost, unuseHost } from "../../../../services/host-project/host-project.js";
import type { HostRow } from "../../../../services/host-project/host-rows.js";
import type { ServiceContext } from "../../../../services/workspace/workspace.js";
import type { FormValues } from "../../../components/index.js";
import { type AsyncState, showToast, type ToastStore } from "../../../hooks/index.js";
import type { HostBusy, HostsTask } from "./hosts-view.js";

/** What the handlers of the Hosts section read and change. */
export interface HostsEnv {
  readonly ctx: ServiceContext;
  readonly toast: ToastStore;
  readonly settings: AsyncState<FactorySettings>;
  readonly rows: AsyncState<HostRow[]>;
  /** The selected host, or `undefined` without hosts. */
  readonly row: HostRow | undefined;
  readonly busy: HostBusy | null;
  readonly setBusy: Dispatch<SetStateAction<HostBusy | null>>;
  readonly setTask: Dispatch<SetStateAction<HostsTask>>;
  readonly setCheck: Dispatch<SetStateAction<HostCheck | null>>;
  readonly onChange: () => void;
}

/** Closes the form and reads the rows and the settings again, also behind Settings. */
function finishChange(env: HostsEnv, message: string): void {
  showToast(env.toast, "info", message);
  env.setTask(null);
  env.rows.reload();
  env.settings.reload();
  env.onChange();
}

/** Saves the placement policy. The service rejects a policy that it does not know. */
export async function savePlacement(env: HostsEnv, values: FormValues): Promise<void> {
  const value = values.placement;
  const change = placementChange({ placement: typeof value === "string" ? value : "" });

  const settings = await updateFactorySettings(change, env.ctx);

  finishChange(env, `Saved the placement: ${settings.placement}`);
}

/** Saves the worker limit of a host. A `VALIDATION` error of the service shows under the field. */
export async function saveWorkers(env: HostsEnv, row: HostRow, values: FormValues): Promise<void> {
  const value = values.maxWorkers;
  const maxWorkers = typeof value === "number" ? value : Number.NaN;

  const host = await updateHost({ id: row.host.id, maxWorkers }, env.ctx);

  finishChange(env, `Saved the worker limit of ${host.id}: ${host.maxWorkers}`);
}

/** Shows a warning and gives true while remote work runs on a host. */
function warnBusy(env: HostsEnv): boolean {
  if (env.busy) {
    showToast(env.toast, "warning", `Wait for the work on ${env.busy.hostId} to end`);
  }

  return env.busy !== null;
}

function textValue(values: FormValues, name: string): string {
  const value = values[name];

  return typeof value === "string" ? value : "";
}

/**
 * Adds a worker host with the values of the form. The form stays busy while the service installs the build and runs
 * the check. A `VALIDATION` error shows under the fields; a different error shows a toast, and the list does not change.
 */
export async function saveNewHost(env: HostsEnv, values: FormValues): Promise<void> {
  const value = values.maxWorkers;
  const maxWorkers = typeof value === "number" ? value : Number.NaN;

  const added = await addHost({ id: textValue(values, "id"), ssh: textValue(values, "ssh"), maxWorkers }, env.ctx);

  finishChange(env, `Added ${added.id}: ${added.check.ready ? "ready" : "not ready"}`);
  env.setCheck(added.check);
}

/** Opens the form of a new host, when no remote work runs. */
export function openAddHost(env: HostsEnv): void {
  if (warnBusy(env)) {
    return;
  }

  env.setTask({ kind: "add" });
}

/** Turns the selected host on or off for all Projects. A failure shows a toast. */
export function toggleEnabled(env: HostsEnv, row: HostRow): void {
  const enabled = !row.host.enabled;

  updateHost({ id: row.host.id, enabled }, env.ctx).then(
    (host) => finishChange(env, `${host.id} is ${host.enabled ? "on" : "off"} for all Projects`),
    (error: unknown) => env.toast.error(error),
  );
}

/** Ends the remote work of a host with a success: it reads the rows again. */
function remoteDone(env: HostsEnv, message: string): void {
  env.setBusy(null);
  env.rows.reload();
  showToast(env.toast, "info", message);
}

/** Ends the remote work of a host with a failure: it shows the message and the hint. The rows do not change. */
function remoteFailed(env: HostsEnv, error: unknown): void {
  env.setBusy(null);
  env.toast.error(error);
}

/** Starts remote work on a host, when no other remote work runs. */
function startRemote(env: HostsEnv, busy: HostBusy, work: () => Promise<string>): void {
  if (warnBusy(env)) {
    return;
  }

  env.setBusy(busy);
  work().then(
    (message) => remoteDone(env, message),
    (error: unknown) => remoteFailed(env, error),
  );
}

async function turnOnForProject(env: HostsEnv, id: string): Promise<string> {
  const used = await turnOnHost({ id }, env.ctx);

  env.onChange();

  return used.cloned ? `${id} cloned the Project to ${used.path}` : `${id} uses the clone at ${used.path}`;
}

async function turnOffForProject(env: HostsEnv, id: string): Promise<string> {
  const unused = await unuseHost({ id }, env.ctx);

  env.onChange();

  return `${id} is off for this Project. The clone at ${unused.path} stays on the host.`;
}

/** Turns the selected host on for this Project (with a clone in the managed folder), or off. */
export function toggleProject(env: HostsEnv, row: HostRow): void {
  const { id } = row.host;

  if (row.usedByProject) {
    startRemote(env, { hostId: id, kind: "unuse" }, () => turnOffForProject(env, id));

    return;
  }

  startRemote(env, { hostId: id, kind: "use" }, () => turnOnForProject(env, id));
}

async function checkOnHost(env: HostsEnv, id: string): Promise<string> {
  const check = await checkHost({ id }, env.ctx);

  env.setCheck(check);

  return check.ready ? `${id} is ready` : `${id} is not ready`;
}

/** Runs the check of the selected host, and shows its items under the list. */
export function runCheck(env: HostsEnv, row: HostRow): void {
  startRemote(env, { hostId: row.host.id, kind: "check" }, () => checkOnHost(env, row.host.id));
}

/** The keys of the section: `p` placement and `a` add host, then `u`, `e`, `w` and `c` on the selected host. */
export function handleHostsKey(env: HostsEnv, input: string, key: Key): void {
  if (key.ctrl || key.meta) {
    return;
  }

  if (input === "p") {
    env.setTask({ kind: "placement" });

    return;
  }

  if (input === "a") {
    openAddHost(env);

    return;
  }

  const { row } = env;

  if (!row) {
    return;
  }

  if (input === "w") {
    env.setTask({ kind: "workers", row });

    return;
  }

  rowKey(env, row, input);
}

function rowKey(env: HostsEnv, row: HostRow, input: string): void {
  if (input === "u") {
    toggleProject(env, row);

    return;
  }

  if (input === "e") {
    toggleEnabled(env, row);

    return;
  }

  if (input === "c") {
    runCheck(env, row);
  }
}
