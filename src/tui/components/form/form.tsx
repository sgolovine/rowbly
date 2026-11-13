import { Box, Text } from "ink";
import { useLayout } from "../../hooks/index.js";
import { theme } from "../../theme.js";
import { FieldRow } from "../field-row/index.js";
import { focusField, moveFocus, setField } from "./form-actions.js";
import type { FieldKind, FormField } from "./form-values.js";
import { type FormProps, type FormView, useForm } from "./use-form.js";

export type { FormField, FormValue, FormValues } from "./form-values.js";
export type { FormProps } from "./use-form.js";

/** Widest an input grows; longer text scrolls inside it. */
const INPUT_MAX_WIDTH = 64;

const FIELD_HELP: Record<FieldKind, string> = {
  text: "type to edit",
  number: "type a number",
  date: "type YYYY-MM-DD",
  boolean: "space toggles",
  switch: "space toggles",
  select: "←/→ change",
  multiselect: "←/→ pick · space toggles",
  multiline: "enter new line · ctrl+f full screen",
};

/** The help line above the fields: what the focused field takes, or how to submit after the last field. */
function helpText({ busy, searchable, field, submitLabel }: FormView): string {
  if (busy) {
    return "Saving…";
  }

  if (searchable) {
    return "type or enter to search";
  }

  return field ? FIELD_HELP[field.kind] : `ctrl+s ${submitLabel}`;
}

function labelWidthOf(fields: readonly FormField[]): number {
  return Math.max(...fields.map((f) => f.label.length + (f.required ? 1 : 0))) + 4;
}

/**
 * A keyboard form with saving in the enclosing Modal hint strip. `enter`, `tab` and `↓` move to the next
 * field and `shift+tab` and `↑` to the previous one; text, number and date fields are `TextInput`s;
 * multiline fields are `TextArea`s, where `enter` starts a new line, `↑/↓` leave the text from its
 * first and last rows and `ctrl+f` opens it full screen; `space` toggles booleans and multiselect options; `←/→` change selects.
 * `ctrl+enter` (or `ctrl+s`) submits from anywhere, and `enter` after the last field submits.
 */
export function Form(props: FormProps) {
  const form = useForm(props);
  const layout = useLayout();

  const { fields, values, errors, focus, active } = form;
  const labelWidth = labelWidthOf(fields);
  const inputWidth = Math.max(16, Math.min(INPUT_MAX_WIDTH, layout.width - labelWidth));
  // A blank line between fields in a terminal; when they do not fit, the body around the form
  // scrolls (the focused field stays in view) rather than the fields closing up.
  const roomy = layout.height !== undefined;

  return (
    <Box flexDirection="column" gap={roomy ? 1 : 0} flexShrink={0}>
      <Text color={theme.inkFaint} wrap="truncate-end">
        {helpText(form)}
      </Text>
      {fields.map((f, i) => (
        <FieldRow
          key={f.name}
          field={f}
          raw={values[f.name] ?? null}
          focused={i === focus}
          active={active}
          error={errors[f.name]}
          labelWidth={labelWidth}
          inputWidth={inputWidth}
          optionCursor={form.optionCursor}
          onChange={(raw) => setField(form, f.name, raw)}
          onLeave={(direction) => moveFocus(form, direction)}
          onClick={() => focusField(form, i)}
        />
      ))}
      <Box flexDirection="column">
        {form.formErrors.map((message) => (
          <Text key={message} color={theme.danger}>
            {message}
          </Text>
        ))}
      </Box>
    </Box>
  );
}
