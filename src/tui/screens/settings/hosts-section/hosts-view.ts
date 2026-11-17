import type { FactorySettings } from "../../../../services/factory-settings/factory-settings.js";
import { DEFAULT_PLACEMENT, PLACEMENT_POLICIES } from "../../../../services/factory-settings/placement-settings.js";
import type { HostLastCheck } from "../../../../services/host/host.js";
import type { HostRow } from "../../../../services/host-project/host-rows.js";
import type { FormField, FormValues } from "../../../components/index.js";
import type { KeyHint } from "../../../keymap.js";
import { formatDateTime } from "../../../theme.js";

/** The form on top of the Hosts section: the placement, the worker limit of one host, a new host, or nothing. */
export type HostsTask =
  | { readonly kind: "placement" }
  | { readonly kind: "workers"; readonly row: HostRow }
  | { readonly kind: "add" }
  | null;

/** The remote work that runs on one host. Only one runs at a time. */
export interface HostBusy {
  readonly hostId: string;
  readonly kind: "use" | "unuse" | "check";
}

/** A form of the section: its title, its fields, the values at the start and a note above the fields. */
export interface HostsForm {
  readonly title: string;
  readonly fields: readonly FormField[];
  readonly initial: FormValues;
  readonly note: string;
}

const NO_VALUE = "—";

/** The CLI command that also adds a worker host. */
export const ADD_HOST_COMMAND = "rowbly host add <id> --ssh <target> --max-workers <n>";

const PLACEMENT_HINT: KeyHint = { key: "p", description: "placement" };

const ADD_HINT: KeyHint = { key: "a", description: "add host" };

const ROW_HINTS: readonly KeyHint[] = [
  { key: "u", description: "this Project" },
  { key: "e", description: "all Projects" },
  { key: "w", description: "workers" },
  { key: "c", description: "check" },
];

/** The placement policy of the settings, or `—` before they load. */
export function placementText(settings: FactorySettings | undefined): string {
  return settings ? (settings.placement ?? DEFAULT_PLACEMENT) : NO_VALUE;
}

/** The worker limit as text. */
export function workersText(maxWorkers: number): string {
  return maxWorkers === 1 ? "1 worker" : `${maxWorkers} workers`;
}

/** The last check as text: `not checked`, or the state and the time, with the IDs of the failed items. */
export function lastCheckText(check: HostLastCheck | null): string {
  if (!check) {
    return "not checked";
  }

  const when = formatDateTime(check.at);

  return check.ready ? `ready · ${when}` : `not ready (${check.failed.join(", ")}) · ${when}`;
}

/** The text of the row while remote work runs on its host. */
export function busyText(busy: HostBusy): string {
  if (busy.kind === "check") {
    return "Checking…";
  }

  return busy.kind === "use" ? "Cloning the Project…" : "Turning off…";
}

/** The form of the placement policy, with the list of the policies of the service. */
function placementForm(settings: FactorySettings | undefined): HostsForm {
  return {
    title: "Hosts › Placement",
    fields: [{ name: "placement", label: "Placement", kind: "select", options: PLACEMENT_POLICIES, required: true }],
    initial: { placement: placementText(settings) === NO_VALUE ? DEFAULT_PLACEMENT : placementText(settings) },
    note: "prefer-local fills the main machine first. most-free uses the machine with the most free slots. prefer-remote fills the worker hosts first.",
  };
}

/** The form of the worker limit of one host. */
function workersForm(row: HostRow): HostsForm {
  return {
    title: `Hosts › ${row.host.id} › Worker limit`,
    fields: [{ name: "maxWorkers", label: "Workers", kind: "number", required: true }],
    initial: { maxWorkers: row.host.maxWorkers },
    note: "The largest number of workers that run on the host at one time, for all Projects.",
  };
}

/** The form of a new host. The field names are the paths of the `VALIDATION` issues of `addHost`. */
function addForm(): HostsForm {
  return {
    title: "Hosts › Add host",
    fields: [
      { name: "id", label: "ID", kind: "text", required: true },
      { name: "ssh", label: "SSH target", kind: "text", required: true },
      { name: "maxWorkers", label: "Workers", kind: "number", required: true },
    ],
    initial: { id: "", ssh: "", maxWorkers: null },
    note: "The ID is dash-case, for example mac-mini. The SSH target is a host or user@host that ssh can reach. Rowbly installs its build on the host, then checks the host. This can take minutes.",
  };
}

/** The form of a task on top of the section. */
export function taskForm(task: NonNullable<HostsTask>, settings: FactorySettings | undefined): HostsForm {
  if (task.kind === "placement") {
    return placementForm(settings);
  }

  return task.kind === "workers" ? workersForm(task.row) : addForm();
}

/**
 * The keys of the section. `a` shows with and without hosts. The row keys show only when a host is selected. No key
 * shows while a form is on top.
 */
export function hostsHints(idle: boolean, hasRows: boolean): readonly KeyHint[] {
  if (!idle) {
    return [];
  }

  return hasRows
    ? [PLACEMENT_HINT, ADD_HINT, { key: "↑/↓", description: "host" }, ...ROW_HINTS]
    : [PLACEMENT_HINT, ADD_HINT];
}
