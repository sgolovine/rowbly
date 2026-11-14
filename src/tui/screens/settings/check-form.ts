import type { CheckItemChange } from "../../../services/factory-settings/check-items.js";
import type { CheckSpec } from "../../../services/factory-settings/factory-settings.js";
import type { FormField, FormValues } from "../../components/index.js";

/** The fields of the check limits form. */
export const CHECK_LIMIT_FIELDS: readonly FormField[] = [
  { name: "maxConcurrent", label: "Checks at the same time", kind: "number", required: true },
  { name: "reserveMemoryMb", label: "Memory to keep free (MB)", kind: "number", required: true },
];

/** The fields of the check form. A new check also has its key. */
export function checkFields(isNew: boolean): FormField[] {
  return [
    ...(isNew ? [{ name: "key", label: "Key", kind: "text" as const, required: true }] : []),
    { name: "label", label: "Label", kind: "text" },
    { name: "command", label: "Command", kind: "text", required: true },
    { name: "narrowCommand", label: "Narrow command ({files})", kind: "text" },
    { name: "memoryMb", label: "Memory estimate (MB)", kind: "number" },
    { name: "timeoutMinutes", label: "Timeout (minutes)", kind: "number" },
    { name: "block", label: "Blocked text (one on each line)", kind: "multiline" },
  ];
}

/** The values of the check form for a check, or empty values for a new check. */
export function checkValues(check: CheckSpec | undefined): FormValues {
  return {
    key: check?.key ?? "",
    label: check && check.label !== check.key ? check.label : "",
    command: check?.command ?? "",
    narrowCommand: check?.narrowCommand ?? "",
    memoryMb: check?.memoryMb ?? null,
    timeoutMinutes: check?.timeoutMinutes ?? null,
    block: check?.block.join("\n") ?? "",
  };
}

export function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function lines(value: unknown): readonly string[] | null {
  const items = typeof value === "string" ? value.split("\n").map((line) => line.trim()) : [];
  const kept = items.filter((line) => line.length > 0);

  return kept.length ? kept : null;
}

/** Gives the change of the form. An empty value removes the key, so that its default applies. */
export function checkChange(values: FormValues): CheckItemChange {
  return {
    label: text(values.label),
    command: text(values.command) ?? "",
    narrowCommand: text(values.narrowCommand),
    memoryMb: typeof values.memoryMb === "number" ? values.memoryMb : null,
    timeoutMinutes: typeof values.timeoutMinutes === "number" ? values.timeoutMinutes : null,
    block: lines(values.block),
  };
}
