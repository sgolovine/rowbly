import { Box, Text, useInput } from 'ink';
import { useState } from 'react';
import { ValidationError } from '../../core';
import { useDirty, useEditor, useIsActive, useKeyCapture, useToast } from '../hooks';

export type FieldKind = 'text' | 'multiline' | 'number' | 'boolean' | 'date' | 'select' | 'multiselect';

export interface FormField {
  /** Key in the submitted values; also matched against `ValidationError` issue paths. */
  name: string;
  label: string;
  kind: FieldKind;
  required?: boolean;
  /** Choices for `select` and `multiselect`. */
  options?: readonly string[];
}

/** text/multiline: string · number: number | null · boolean · date: `YYYY-MM-DD` | null · select: string | null · multiselect: string[] */
export type FormValue = string | number | boolean | string[] | null;
export type FormValues = Record<string, FormValue>;

export interface FormProps {
  fields: readonly FormField[];
  initialValues?: FormValues;
  /** May throw: a `ValidationError` shows its issues inline, any other error becomes a toast. */
  onSubmit(values: FormValues): void | Promise<void>;
  isActive?: boolean;
}

type Raw = string | boolean | string[] | null;

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

/**
 * A keyboard form. `↑/↓` move between fields; text, number and date fields take typing;
 * `space` toggles booleans and multiselect options; `←/→` change selects; `e` opens `$EDITOR` on a
 * multiline field; `enter` or `ctrl+s` submits.
 */
export function Form({ fields, initialValues = {}, onSubmit, isActive = true }: FormProps) {
  const active = useIsActive() && isActive;
  const toast = useToast();
  const edit = useEditor();
  const [initial] = useState(() => Object.fromEntries(fields.map((f) => [f.name, toRaw(f, initialValues[f.name])])));
  const [values, setValues] = useState<Record<string, Raw>>(initial);
  const [focus, setFocus] = useState(0);
  const [optionCursor, setOptionCursor] = useState(0);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formErrors, setFormErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const field = fields[focus];
  const dirty = fields.some((f) => JSON.stringify(values[f.name]) !== JSON.stringify(initial[f.name]));
  useDirty(dirty);
  useKeyCapture(active && field !== undefined && TYPED_KINDS.includes(field.kind));

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

  const openEditor = async (name: string, current: string) => {
    try {
      set(name, await edit(current));
    } catch (err) {
      toast.error(err);
    }
  };

  const moveFocus = (delta: number) => {
    setFocus((f) => Math.max(0, Math.min(fields.length - 1, f + delta)));
    setOptionCursor(0);
  };

  useInput(
    (input, key) => {
      if (busy || !field) return;
      const raw = values[field.name] ?? null;
      const typed = TYPED_KINDS.includes(field.kind);
      if (key.return || (key.ctrl && input === 's')) {
        void submit();
      } else if (key.upArrow || (!typed && input === 'k')) {
        moveFocus(-1);
      } else if (key.downArrow || (!typed && input === 'j')) {
        moveFocus(1);
      } else if (typed) {
        if (key.backspace || key.delete) set(field.name, String(raw).slice(0, -1));
        else if (input && !key.ctrl && !key.meta && !key.escape) set(field.name, String(raw) + input);
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
      } else if (field.kind === 'multiline' && (input === 'e' || input === ' ')) {
        void openEditor(field.name, typeof raw === 'string' ? raw : '');
      }
    },
    { isActive: active },
  );

  const labelWidth = Math.max(...fields.map((f) => f.label.length)) + 3;
  return (
    <Box flexDirection="column">
      {fields.map((f, i) => {
        const focused = i === focus && active;
        return (
          <Box key={f.name} flexDirection="column">
            <Box>
              <Box width={labelWidth} flexShrink={0}>
                <Text color={focused ? 'cyan' : undefined}>
                  {i === focus ? '› ' : '  '}
                  {f.label}
                  {f.required ? '*' : ''}
                </Text>
              </Box>
              <FieldValue field={f} raw={values[f.name] ?? null} focused={focused} optionCursor={optionCursor} />
            </Box>
            {errors[f.name] && <Text color="red">{`${' '.repeat(labelWidth)}${errors[f.name]}`}</Text>}
          </Box>
        );
      })}
      {formErrors.map((message) => (
        <Text key={message} color="red">
          {message}
        </Text>
      ))}
      <Text dimColor>{busy ? 'Saving…' : 'enter/ctrl+s submit · ↑/↓ move'}</Text>
    </Box>
  );
}

function FieldValue({
  field,
  raw,
  focused,
  optionCursor,
}: {
  field: FormField;
  raw: Raw;
  focused: boolean;
  optionCursor: number;
}) {
  switch (field.kind) {
    case 'boolean':
      return <Text>{raw === true ? '[x] yes' : '[ ] no'}</Text>;
    case 'select':
      return <Text>{`‹ ${typeof raw === 'string' ? raw : '—'} ›`}</Text>;
    case 'multiselect': {
      const checked = Array.isArray(raw) ? raw : [];
      return (
        <Box gap={2} flexWrap="wrap">
          {(field.options ?? []).map((option, i) => (
            <Text key={option} underline={focused && i === optionCursor}>
              {checked.includes(option) ? '[x] ' : '[ ] '}
              {option}
            </Text>
          ))}
        </Box>
      );
    }
    case 'multiline': {
      const text = typeof raw === 'string' ? raw : '';
      const lines = text.split('\n').filter((line) => line.trim());
      const preview =
        lines.length === 0 ? '(empty)' : `${lines[0]}${lines.length > 1 ? ` (+${lines.length - 1} lines)` : ''}`;
      return (
        <Text>
          <Text dimColor={lines.length === 0}>{preview}</Text>
          {focused && <Text dimColor> e to edit</Text>}
        </Text>
      );
    }
    default:
      return (
        <Text>
          {String(raw)}
          {focused && <Text inverse> </Text>}
          {field.kind === 'date' && raw === '' && <Text dimColor>YYYY-MM-DD</Text>}
        </Text>
      );
  }
}
