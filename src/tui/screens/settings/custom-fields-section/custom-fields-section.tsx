import { Box, Text, useInput } from "ink";
import { useState } from "react";
import type { CustomField } from "../../../../services/config/config.js";
import { listCustomFields, removeCustomField } from "../../../../services/custom-field/custom-field.js";
import { Button, ConfirmDialog, Loading, SelectionRow } from "../../../components/index.js";
import { useAsync, useCursor, useIsActive, useKeyHints, useToast } from "../../../hooks/index.js";
import { theme } from "../../../theme.js";
import { CustomFieldFormModal } from "../custom-field-form-modal/index.js";
import type { SettingsSectionProps } from "../settings-sections.js";

type Mode =
  | { kind: "list" }
  | { kind: "new" }
  | { kind: "edit"; field: CustomField }
  | { kind: "remove"; field: CustomField };

/** `select: a, b` for a select field, the type for all other fields. */
function describeType(field: CustomField): string {
  return field.type === "select" ? `select: ${field.options?.join(", ") ?? ""}` : field.type;
}

/**
 * The Custom Fields of the project. Each Story has a value for each field. `n` or the
 * **+ New Custom Field** Button adds a field, `enter`
 * or `e` edits the selected field, as a click on its row does, and `d` removes it and its values after a confirmation.
 */
export function CustomFieldsSection({ ctx, onChange }: SettingsSectionProps) {
  const active = useIsActive();
  const toast = useToast();
  const [mode, setMode] = useState<Mode>({ kind: "list" });
  const list = useAsync(() => listCustomFields(ctx), [ctx]);
  const fields = list.data ?? [];
  const idle = active && mode.kind === "list";
  const [cursor, setCursor] = useCursor(fields.length, idle);
  const current = fields[cursor];

  const done = () => {
    setMode({ kind: "list" });
    list.reload();
    onChange();
  };

  useKeyHints(
    idle
      ? [
          { key: "↑/↓", description: "select" },
          { key: "n", description: "new Custom Field" },
          ...(current
            ? [
                { key: "enter", description: "edit" },
                { key: "d", description: "remove" },
              ]
            : []),
        ]
      : [],
  );
  useInput(
    (input, key) => {
      if (input === "n") setMode({ kind: "new" });
      else if (current && (key.return || input === "e")) setMode({ kind: "edit", field: current });
      else if (current && input === "d") setMode({ kind: "remove", field: current });
    },
    { isActive: idle },
  );

  if (!list.data) return list.loading ? <Loading label="Loading Custom Fields…" /> : null;
  const labelWidth = Math.max(0, ...fields.map((f) => f.label.length)) + 2;
  const keyWidth = Math.max(0, ...fields.map((f) => f.key.length)) + 2;
  return (
    <Box flexDirection="column">
      {fields.length === 0 && <Text color={theme.inkFaint}>No Custom Fields. Press n to add one.</Text>}
      {fields.map((field, i) => (
        <SelectionRow
          key={field.key}
          selected={i === cursor}
          active={idle}
          onClick={() => {
            setCursor(i);
            setMode({ kind: "edit", field });
          }}
        >
          <Box>
            <Box width={labelWidth} flexShrink={0}>
              <Text color={theme.ink} bold={i === cursor}>
                {field.label}
              </Text>
            </Box>
            <Box width={keyWidth} flexShrink={0}>
              <Text color={i === cursor ? theme.inkMuted : theme.inkFaint}>{field.key}</Text>
            </Box>
            <Text color={theme.inkMuted} wrap="truncate-end">
              {describeType(field)}
            </Text>
          </Box>
        </SelectionRow>
      ))}
      <Box marginTop={1}>
        <Button
          label="+ New Custom Field"
          keyName="n"
          onClick={() => setMode({ kind: "new" })}
          clickable={idle}
          compact
        />
      </Box>
      {(mode.kind === "new" || mode.kind === "edit") && (
        <CustomFieldFormModal
          ctx={ctx}
          field={mode.kind === "edit" ? mode.field : undefined}
          onClose={() => setMode({ kind: "list" })}
          onSaved={done}
        />
      )}
      {mode.kind === "remove" && (
        <ConfirmDialog
          title={`Remove Custom Field › ${mode.field.label}`}
          message={`Remove ${mode.field.label}? Rowbly also removes its value from each Story.`}
          confirmLabel="Remove"
          cancelLabel="Cancel"
          destructive
          onConfirm={() => {
            const { field } = mode;
            removeCustomField({ key: field.key }, ctx).then(
              () => {
                toast.push("info", `Removed ${field.label}`);
                done();
              },
              (err: unknown) => {
                toast.error(err);
                setMode({ kind: "list" });
              },
            );
          }}
          onCancel={() => setMode({ kind: "list" })}
        />
      )}
    </Box>
  );
}
