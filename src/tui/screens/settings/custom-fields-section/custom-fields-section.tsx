import { Box, type Key, Text, useInput } from "ink";
import { type Dispatch, type SetStateAction, useState } from "react";
import type { CustomField } from "../../../../services/config/config.js";
import { listCustomFields, removeCustomField } from "../../../../services/custom-field/custom-field.js";
import type { ServiceContext } from "../../../../services/workspace/workspace.js";
import { Button, ConfirmDialog, Loading } from "../../../components/index.js";
import {
  type AsyncState,
  showToast,
  type ToastStore,
  useAsync,
  useCursor,
  useIsActive,
  useKeyHints,
  useToast,
} from "../../../hooks/index.js";
import type { KeyHint } from "../../../keymap.js";
import { theme } from "../../../theme.js";
import { columnWidth } from "../column-width.js";
import { CustomFieldFormModal } from "../custom-field-form-modal/index.js";
import { CustomFieldRow } from "../custom-field-row/index.js";
import type { SettingsSectionProps } from "../settings-sections.js";

type Mode =
  | { readonly kind: "list" }
  | { readonly kind: "new" }
  | { readonly kind: "edit"; readonly field: CustomField }
  | { readonly kind: "remove"; readonly field: CustomField };

/** What the handlers of the section read and change. */
interface FieldsEnv {
  readonly ctx: ServiceContext;
  readonly toast: ToastStore;
  readonly list: AsyncState<CustomField[]>;
  readonly current: CustomField | undefined;
  readonly setMode: Dispatch<SetStateAction<Mode>>;
  readonly setCursor: (index: number) => void;
  readonly onChange: () => void;
}

function fieldsHints(idle: boolean, current: CustomField | undefined): KeyHint[] {
  if (!idle) {
    return [];
  }

  return [
    { key: "↑/↓", description: "select" },
    { key: "n", description: "new Custom Field" },
    ...(current
      ? [
          { key: "enter", description: "edit" },
          { key: "d", description: "remove" },
        ]
      : []),
  ];
}

/** Goes back to the list and reads the fields again, also in the screens behind Settings. */
function done(env: FieldsEnv): void {
  env.setMode({ kind: "list" });
  env.list.reload();
  env.onChange();
}

function fieldKey(env: FieldsEnv, input: string, key: Key): void {
  if (input === "n") {
    env.setMode({ kind: "new" });

    return;
  }

  if (env.current && (key.return || input === "e")) {
    env.setMode({ kind: "edit", field: env.current });

    return;
  }

  if (env.current && input === "d") {
    env.setMode({ kind: "remove", field: env.current });
  }
}

function openField(env: FieldsEnv, index: number, field: CustomField): void {
  env.setCursor(index);
  env.setMode({ kind: "edit", field });
}

/** Removes the field and its values. A failure goes back to the list. */
function removeField(env: FieldsEnv, field: CustomField): void {
  removeCustomField({ key: field.key }, env.ctx).then(
    () => removed(env, field),
    (err: unknown) => removeFailed(env, err),
  );
}

function removed(env: FieldsEnv, field: CustomField): void {
  showToast(env.toast, "info", `Removed ${field.label}`);
  done(env);
}

function removeFailed(env: FieldsEnv, err: unknown): void {
  env.toast.error(err);
  env.setMode({ kind: "list" });
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
  const env: FieldsEnv = { ctx, toast, list, current, setMode, setCursor, onChange };

  useKeyHints(fieldsHints(idle, current));
  useInput((input, key) => fieldKey(env, input, key), { isActive: idle });

  if (!list.data) {
    return list.loading ? <Loading label="Loading Custom Fields…" /> : null;
  }

  const labelWidth = columnWidth(fields.map((f) => f.label));
  const keyWidth = columnWidth(fields.map((f) => f.key));

  return (
    <Box flexDirection="column">
      {fields.length === 0 && <Text color={theme.inkFaint}>No Custom Fields. Press n to add one.</Text>}
      {fields.map((field, i) => (
        <CustomFieldRow
          key={field.key}
          field={field}
          selected={i === cursor}
          active={idle}
          labelWidth={labelWidth}
          keyWidth={keyWidth}
          onClick={() => openField(env, i, field)}
        />
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
          onSaved={() => done(env)}
        />
      )}
      {mode.kind === "remove" && (
        <ConfirmDialog
          title={`Remove Custom Field › ${mode.field.label}`}
          message={`Remove ${mode.field.label}? Rowbly also removes its value from each Story.`}
          confirmLabel="Remove"
          cancelLabel="Cancel"
          destructive
          onConfirm={() => removeField(env, mode.field)}
          onCancel={() => setMode({ kind: "list" })}
        />
      )}
    </Box>
  );
}
