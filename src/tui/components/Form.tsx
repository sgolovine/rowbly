import { Box, type Key, Text, useInput } from 'ink';
import { useContext, useEffect, useId, useState } from 'react';
import { ValidationError } from '../../core';
import type { PluginFieldKind, PluginFormValue } from '../../services';
import { ScreenDepthContext, ShellContext, useDirty, useIsActive, useLayout, useToast } from '../hooks';
import { FORM_KEYS } from '../keymap';
import { theme } from '../theme';
import { FieldRow } from './FieldRow';
import { FormKeysContext } from './modalLayer';

/** Defined once with the Plugin API's form fields, so the two cannot drift apart (CQ-18, ARCH-19). */
export type FieldKind = PluginFieldKind;

export interface FormField {
  /** Key in the submitted values; also matched against `ValidationError` issue paths. */
  name: string;
  label: string;
  kind: FieldKind;
  required?: boolean;
  /** Choices for `select` and `multiselect`. */
  options?: readonly string[];
  /** What a choice shows instead of its value, e.g. a Stage's name for its key. */
  optionLabels?: Readonly<Record<string, string>>;
}

/** text/multiline: string · number: number | null · boolean · date: `YYYY-MM-DD` | null · select: string | null · multiselect: string[] */
export type FormValue = PluginFormValue;
export type FormValues = Record<string, FormValue>;

export interface FormProps {
  fields: readonly FormField[];
  initialValues?: FormValues;
  /** May throw: a `ValidationError` shows its issues inline, any other error becomes a toast. */
  onSubmit(values: FormValues): void | Promise<void>;
  isActive?: boolean;
}

type Raw = string | boolean | string[] | null;

/** Kinds edited in a `TextInput`, where letters are text rather than keys. */
const TYPED_KINDS: readonly FieldKind[] = ['text', 'number', 'date'];

function toRaw(field: FormField, value: FormValue | undefined): Raw {
  switch (field.kind) {
    case 'boolean':
      return value === true;
    case 'select':
      return typeof value === 'string' ? value : null;
    case 'multiselect':
      return Array.isArray(value) ? value : [];
    default:
      return value === null || value === undefined ? '' : String(value);
  }
}

function isEmpty(raw: Raw): boolean {
  return raw === null || raw === '' || (Array.isArray(raw) && raw.length === 0);
}

/** Converts raw input to a value, or returns an error message. */
function parse(field: FormField, raw: Raw): { value: FormValue } | { error: string } {
  if (field.required && isEmpty(raw)) return { error: 'required' };
  if (field.kind === 'number') {
    if (raw === '') return { value: null };
    const n = Number(raw);
    return Number.isFinite(n) ? { value: n } : { error: 'must be a number' };
  }
  if (field.kind === 'date') {
    if (raw === '') return { value: null };
    const ok = typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw) && !Number.isNaN(Date.parse(raw));
    return ok ? { value: raw } : { error: 'must be a date (YYYY-MM-DD)' };
  }
  return { value: raw };
}

/**
 * `value` as the form submits it for `field` when it is left alone: `''` for empty text, `null` for an
 * empty number, date or select, `false` for an unset boolean, `[]` for an unset multiselect, and a
 * number for a number given as text. A value the form could not submit is returned as it is.
 */
export function normalizeFormValue(field: Pick<FormField, 'kind'>, value: FormValue | undefined): FormValue {
  const optional: FormField = { name: '', label: '', kind: field.kind };
  const result = parse(optional, toRaw(optional, value));
  return 'error' in result ? (value ?? null) : result.value;
}

/** Whether two submitted values are the same; the order of a multiselect's choices does not count. */
export function sameFormValue(a: FormValue, b: FormValue): boolean {
  if (Array.isArray(a) && Array.isArray(b)) return JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
  return a === b;
}

/** Maps `ValidationError.details.issues` (zod issues) to fields by the first path segment. */
function issuesByField(
  err: ValidationError,
  fields: readonly FormField[],
): { byField: Record<string, string>; rest: string[] } {
  const byField: Record<string, string> = {};
  const rest: string[] = [];
  const issues = Array.isArray(err.details.issues) ? err.details.issues : [];
  for (const issue of issues as { path?: unknown[]; message?: string }[]) {
    const name = issue.path?.[0];
    const message = issue.message ?? 'invalid';
    if (typeof name === 'string' && fields.some((f) => f.name === name)) byField[name] ??= message;
    else rest.push(message);
  }
  if (issues.length === 0) rest.push(err.message);
  return { byField, rest };
}

/** Whether a key submits the form from any field: `ctrl+enter`, or `ctrl+s` where the terminal cannot tell `ctrl+enter` from `enter`. */
function isSubmitKey(input: string, key: Key): boolean {
  return (key.return && key.ctrl) || (key.ctrl && input === 's');
}

/**
 * Shows the Form keys while `active`: in the strip of the Modal around the form, or else with the
 * screen's own hints, so every form says `ctrl+s save` without its screen adding it.
 */
function useFormKeys(active: boolean): void {
  const modal = useContext(FormKeysContext);
  const shell = useContext(ShellContext);
  const depth = useContext(ScreenDepthContext);
  const id = useId();
  useEffect(() => {
    if (!active) return;
    if (modal) return modal();
    if (depth < 0) return;
    shell.setHints(depth, id, FORM_KEYS, true);
    return () => shell.setHints(depth, id, null);
  }, [active, modal, shell, depth, id]);
}

/**
 * A keyboard form with saving in the enclosing Modal hint strip. `enter`, `tab` and `↓` move to the next
 * field and `shift+tab` and `↑` to the previous one; text, number and date fields are `TextInput`s;
 * multiline fields are `TextArea`s, where `enter` starts a new line, `↑/↓` leave the text from its
 * first and last rows and `ctrl+f` opens it full screen; `space` toggles booleans and multiselect options; `←/→` change selects.
 * `ctrl+enter` (or `ctrl+s`) submits from anywhere, and `enter` after the last field submits.
 */
export function Form({ fields, initialValues = {}, onSubmit, isActive = true }: FormProps) {
  const active = useIsActive() && isActive;
  const toast = useToast();
  const layout = useLayout();
  const [initial] = useState(() => Object.fromEntries(fields.map((f) => [f.name, toRaw(f, initialValues[f.name])])));
  const [values, setValues] = useState<Record<string, Raw>>(initial);
  const [focus, setFocus] = useState(0);
  const [optionCursor, setOptionCursor] = useState(0);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formErrors, setFormErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  // `focus === fields.length` accepts Enter to submit without a separate button.
  const field = fields[focus];
  useFormKeys(active);
  const dirty = fields.some((f) => JSON.stringify(values[f.name]) !== JSON.stringify(initial[f.name]));
  useDirty(dirty);

  const set = (name: string, raw: Raw) => {
    setValues((prev) => ({ ...prev, [name]: raw }));
    setErrors(({ [name]: _cleared, ...rest }) => rest);
  };

  const submit = async () => {
    const parsed: FormValues = {};
    const found: Record<string, string> = {};
    for (const f of fields) {
      const result = parse(f, values[f.name] ?? null);
      if ('error' in result) found[f.name] = result.error;
      else parsed[f.name] = result.value;
    }
    setErrors(found);
    setFormErrors([]);
    if (Object.keys(found).length > 0) return;
    setBusy(true);
    try {
      await onSubmit(parsed);
    } catch (err) {
      if (err instanceof ValidationError) {
        const { byField, rest } = issuesByField(err, fields);
        setErrors(byField);
        setFormErrors(rest);
      } else toast.error(err);
    } finally {
      setBusy(false);
    }
  };

  const moveFocus = (delta: number) => {
    setFocus((f) => Math.max(0, Math.min(fields.length, f + delta)));
    setOptionCursor(0);
  };

  useInput(
    (input, key) => {
      if (busy) return;
      if (isSubmitKey(input, key)) {
        void submit();
        return;
      }
      if (key.tab) {
        moveFocus(key.shift ? -1 : 1);
        return;
      }
      if (!field) {
        if (key.return) void submit();
        else if (key.upArrow || input === 'k') moveFocus(-1);
        return;
      }
      // The TextArea handles its own `enter` and `↑/↓`, and calls back when they leave it.
      if (field.kind === 'multiline') return;
      const raw = values[field.name] ?? null;
      const typed = TYPED_KINDS.includes(field.kind);
      if (key.return || key.downArrow || (!typed && input === 'j')) {
        moveFocus(1);
      } else if (key.upArrow || (!typed && input === 'k')) {
        moveFocus(-1);
      } else if (field.kind === 'boolean') {
        if (input === ' ' || key.leftArrow || key.rightArrow) set(field.name, raw !== true);
      } else if (field.kind === 'select') {
        const options = field.options ?? [];
        const step = key.rightArrow || input === 'l' || input === ' ' ? 1 : key.leftArrow || input === 'h' ? -1 : 0;
        if (step && options.length > 0) {
          const at = typeof raw === 'string' ? options.indexOf(raw) : -1;
          set(field.name, options[(at + step + options.length) % options.length] ?? null);
        }
      } else if (field.kind === 'multiselect') {
        const options = field.options ?? [];
        if (key.rightArrow || input === 'l') setOptionCursor((c) => Math.min(options.length - 1, c + 1));
        else if (key.leftArrow || input === 'h') setOptionCursor((c) => Math.max(0, c - 1));
        else if (input === ' ') {
          const option = options[optionCursor];
          const current = Array.isArray(raw) ? raw : [];
          if (option !== undefined) {
            set(field.name, current.includes(option) ? current.filter((o) => o !== option) : [...current, option]);
          }
        }
      }
    },
    { isActive: active },
  );

  const labelWidth = Math.max(...fields.map((f) => f.label.length + (f.required ? 1 : 0))) + 4;
  const inputWidth = Math.max(16, Math.min(INPUT_MAX_WIDTH, layout.width - labelWidth));
  // Space the fields out when the room allows: a blank line after each field plus the button row. A
  // multiline field has its Full screen button below its rows.
  const lines = fields.reduce((sum, f) => sum + (f.kind === 'multiline' ? TEXTAREA_ROWS + 1 : 1) + 1, 0);
  const roomy = layout.height !== undefined && layout.height >= lines + 3;
  return (
    <Box flexDirection="column" gap={roomy ? 1 : 0}>
      <Text color={theme.inkFaint} wrap="truncate-end">
        {busy ? 'Saving…' : field ? FIELD_HELP[field.kind] : 'ctrl+s save'}
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
          optionCursor={optionCursor}
          onChange={(raw) => set(f.name, raw)}
          onLeave={moveFocus}
          onClick={() => {
            if (i !== focus) moveFocus(i - focus);
          }}
        />
      ))}
      <Box flexDirection="column">
        {formErrors.map((message) => (
          <Text key={message} color={theme.danger}>
            {message}
          </Text>
        ))}
      </Box>
    </Box>
  );
}

/** Widest an input grows; longer text scrolls inside it. */
const INPUT_MAX_WIDTH = 64;
/** Rows a multiline field shows; longer text scrolls inside it. */
const TEXTAREA_ROWS = 5;

const FIELD_HELP: Record<FieldKind, string> = {
  text: 'type to edit',
  number: 'type a number',
  date: 'type YYYY-MM-DD',
  boolean: 'space toggles',
  select: '←/→ change',
  multiselect: '←/→ pick · space toggles',
  multiline: 'enter new line · ctrl+f full screen',
};
