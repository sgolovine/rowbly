import type { FactorySettings } from "../../../../services/factory-settings/factory-settings.js";
import { DEFAULT_PLACEMENT, PLACEMENT_POLICIES } from "../../../../services/factory-settings/placement-settings.js";
import type { HostLastCheck } from "../../../../services/host/host.js";
import type { HostRow } from "../../../../services/host-project/host-rows.js";
import type { FormField } from "../../../components/index.js";
import type { KeyHint } from "../../../keymap.js";
import { formatDateTime } from "../../../theme.js";

/** The form on top of the Hosts section: the placement, the worker limit of one host, or nothing. */
export type HostsTask = { readonly kind: "placement" } | { readonly kind: "workers"; readonly row: HostRow } | null;

/** The remote work that runs on one host. Only one runs at a time. */
export interface HostBusy {
  readonly hostId: string;
  readonly kind: "use" | "unuse" | "check";
}

/** The form of one value: its title, its field, the value at the start and a note above the field. */
export interface HostsForm {
  readonly title: string;
  readonly field: FormField;
  readonly initial: string | number;
  readonly note: string;
}

const NO_VALUE = "—";

/** The command that adds a worker host. The TUI does not add hosts. */
export const ADD_HOST_COMMAND = "rowbly host add <id> --ssh <target> --max-workers <n>";

const PLACEMENT_HINT: KeyHint = { key: "p", description: "placement" };

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
export function placementForm(settings: FactorySettings | undefined): HostsForm {
  return {
    title: "Hosts › Placement",
    field: { name: "placement", label: "Placement", kind: "select", options: PLACEMENT_POLICIES, required: true },
    initial: placementText(settings) === NO_VALUE ? DEFAULT_PLACEMENT : placementText(settings),
    note: "prefer-local fills the main machine first. most-free uses the machine with the most free slots. prefer-remote fills the worker hosts first.",
  };
}

/** The form of the worker limit of one host. */
export function workersForm(row: HostRow): HostsForm {
  return {
    title: `Hosts › ${row.host.id} › Worker limit`,
    field: { name: "maxWorkers", label: "Workers", kind: "number", required: true },
    initial: row.host.maxWorkers,
    note: "The largest number of workers that run on the host at one time, for all Projects.",
  };
}

/** The keys of the section. The row keys show only when a host is selected. No key shows while a form is on top. */
export function hostsHints(idle: boolean, hasRows: boolean): readonly KeyHint[] {
  if (!idle) {
    return [];
  }

  return hasRows ? [PLACEMENT_HINT, { key: "↑/↓", description: "host" }, ...ROW_HINTS] : [PLACEMENT_HINT];
}
