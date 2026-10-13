import { Box, Text, useInput } from 'ink';
import { useState } from 'react';
import { ValidationError } from '../../../core';
import { type CustomFieldDef, type CustomFieldType, CustomFieldTypeSchema } from '../../../schemas';
import type { CustomFieldPatch } from '../../../services';
import { readLevel } from '../../../services/_configTarget';
import { ConfirmDialog, Form, type FormField, type FormValues, Loading, SelectList } from '../../components';
import {
  useAsync,
  useIsActive,
  useKeyCapture,
  useKeyHints,
  useRowblyContext,
  useServices,
  useToast,
} from '../../hooks';
import {
  type ConfigScope,
  CursorRows,
  LevelBar,
  type LevelName,
  levelsFor,
  targetFor,
  useConfigScope,
  useCursor,
  useEscape,
} from '../stages/shared';
import type { ScreenProps, ScreenRegistry } from '../types';

type Mode =
  | { kind: 'list' }
  | { kind: 'pick-type' }
  | { kind: 'add'; type: CustomFieldType }
  | { kind: 'edit'; field: CustomFieldDef }
  | { kind: 'confirm-remove'; field: CustomFieldDef };

/** Custom Field management: a list, a type-specific form, and a level switcher. */
function FieldsScreen({ params }: ScreenProps) {
  const scope = useConfigScope(params);
  if (!scope.data) {
    return scope.loading ? (
      <Loading label="Loading Custom Fields…" />
    ) : (
      <Text color="red">No Custom Fields to show.</Text>
    );
  }
  return <FieldsEditor scope={scope.data} />;
}

function FieldsEditor({ scope }: { scope: ConfigScope }) {
  const services = useServices();
  const ctx = useRowblyContext();
  const toast = useToast();
  const active = useIsActive();
  const levels = levelsFor(scope);
  const [level, setLevel] = useState<LevelName>(levels[0] ?? 'global');
  const [mode, setMode] = useState<Mode>({ kind: 'list' });
  const target = targetFor(scope, level);
  const list = useAsync(async () => (ctx ? readLevel(ctx, target, 'customFields') : null), [ctx, level, scope]);
  const fields = list.data?.items ?? [];
  const listing = mode.kind === 'list';
  const [cursor, setCursor] = useCursor(fields.length, active && listing);
  const current = fields[cursor];

  const done = (message: string) => {
    toast.push('info', message);
    setMode({ kind: 'list' });
    list.reload();
  };

  useKeyCapture(active && !listing, { escape: true });
  useEscape(active && mode.kind !== 'list' && mode.kind !== 'confirm-remove', () => setMode({ kind: 'list' }));
  useKeyHints(
    listing
      ? [
          { key: 'n', description: 'add' },
          { key: 'e', description: 'edit' },
          { key: 'd', description: 'remove' },
          { key: 'l', description: 'switch level' },
        ]
      : [{ key: 'esc', description: 'cancel' }],
  );

  useInput(
    (input) => {
      if (input === 'l') {
        setLevel(levels[(levels.indexOf(level) + 1) % levels.length] ?? level);
        setCursor(0);
      } else if (input === 'n') setMode({ kind: 'pick-type' });
      else if (current && input === 'e') setMode({ kind: 'edit', field: current });
      else if (current && input === 'd') setMode({ kind: 'confirm-remove', field: current });
    },
    { isActive: active && listing && !list.loading },
  );

  return (
    <Box flexDirection="column" gap={1}>
      <LevelBar levels={levels} level={level} source={list.data?.source} />
      {list.loading && !list.data ? (
        <Loading label="Loading Custom Fields…" />
      ) : fields.length === 0 ? (
        <Text dimColor>No Custom Fields. Press n to add one.</Text>
      ) : (
        <CursorRows
          cursor={cursor}
          active={active && listing}
          rows={fields.map((f) => (
            <Text key={f.key}>
              {f.name}
              {f.required ? '*' : ''} <Text dimColor>{`${f.key} · ${describeField(f)}`}</Text>
            </Text>
          ))}
        />
      )}
      {mode.kind === 'pick-type' && (
        <Box flexDirection="column">
          <Text bold>Field type</Text>
          <SelectList
            items={CustomFieldTypeSchema.options.map((type) => ({ value: type, label: type }))}
            onSelect={(item) => setMode({ kind: 'add', type: item.value })}
          />
        </Box>
      )}
      {mode.kind === 'add' && (
        <Box flexDirection="column">
          <Text bold>Add a {mode.type} field</Text>
          <Form
            fields={[{ name: 'key', label: 'Key', kind: 'text', required: true }, ...formFields(mode.type)]}
            initialValues={{ required: false, integer: false }}
            onSubmit={async (values) => {
              const def = { key: String(values.key), type: mode.type, ...toProps(mode.type, values, false) };
              await services.fields.add(target, def as Parameters<typeof services.fields.add>[1]);
              done(`Added ${def.name}`);
            }}
          />
        </Box>
      )}
      {mode.kind === 'edit' && (
        <Box flexDirection="column">
          <Text bold>
            Edit {mode.field.key} <Text dimColor>({mode.field.type})</Text>
          </Text>
          <Form
            fields={formFields(mode.field.type)}
            initialValues={initialValues(mode.field)}
            onSubmit={async (values) => {
              await services.fields.update(target, mode.field.key, toProps(mode.field.type, values, true));
              done(`Updated ${mode.field.key}`);
            }}
          />
        </Box>
      )}
      {mode.kind === 'confirm-remove' && (
        <ConfirmDialog
          message={`Remove Custom Field ${mode.field.name} at the ${level} level? Its values are stripped from Stories.`}
          confirmLabel="Remove"
          cancelLabel="Cancel"
          destructive
          onConfirm={() => {
            services.fields.remove(target, mode.field.key).then(
              ({ valuesStripped }) => done(`Removed ${mode.field.name}; stripped ${valuesStripped} values`),
              (err: unknown) => {
                toast.error(err);
                setMode({ kind: 'list' });
              },
            );
          }}
          onCancel={() => setMode({ kind: 'list' })}
        />
      )}
    </Box>
  );
}

/** The form for a field type: the shared properties plus the type's own settings. */
function formFields(type: CustomFieldType): FormField[] {
  const fields: FormField[] = [
    { name: 'name', label: 'Name', kind: 'text', required: true },
    { name: 'description', label: 'Description', kind: 'text' },
    { name: 'required', label: 'Required', kind: 'boolean' },
  ];
  if (type === 'select' || type === 'multiselect') {
    fields.push({ name: 'options', label: 'Options (a,b,c)', kind: 'text', required: true });
  }
  if (type === 'number') {
    fields.push(
      { name: 'min', label: 'Min', kind: 'number' },
      { name: 'max', label: 'Max', kind: 'number' },
      { name: 'integer', label: 'Whole numbers', kind: 'boolean' },
    );
  }
  return fields;
}

function initialValues(field: CustomFieldDef): FormValues {
  return {
    name: field.name,
    description: field.description ?? '',
    required: field.required,
    ...(field.type === 'select' || field.type === 'multiselect' ? { options: field.options.join(',') } : {}),
    ...(field.type === 'number'
      ? { min: field.min ?? null, max: field.max ?? null, integer: field.integer ?? false }
      : {}),
  };
}

/** Form values → field properties. On edit, cleared min/max become `null` so the service removes them. */
function toProps(type: CustomFieldType, values: FormValues, editing: boolean): CustomFieldPatch {
  const description = String(values.description ?? '');
  const props: CustomFieldPatch = {
    name: String(values.name),
    required: values.required === true,
    ...(description ? { description } : editing ? { description: null } : {}),
  };
  if (type === 'select' || type === 'multiselect') {
    const options = String(values.options ?? '')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean);
    if (options.length === 0) {
      throw new ValidationError('options required', {
        details: { issues: [{ path: ['options'], message: 'required' }] },
      });
    }
    props.options = [...new Set(options)];
  }
  if (type === 'number') {
    for (const prop of ['min', 'max'] as const) {
      const value = values[prop];
      if (typeof value === 'number') props[prop] = value;
      else if (editing) props[prop] = null;
    }
    if (values.integer === true) props.integer = true;
    else if (editing) props.integer = false;
  }
  return props;
}

/** A Custom Field's type and its settings, e.g. `select: s, m, l` or `number (≥ 0)`. */
export function describeField(f: CustomFieldDef): string {
  if (f.type === 'select' || f.type === 'multiselect') return `${f.type}: ${f.options.join(', ')}`;
  if (f.type === 'number') {
    const limits = [
      f.integer ? 'integer' : '',
      f.min !== undefined ? `≥ ${f.min}` : '',
      f.max !== undefined ? `≤ ${f.max}` : '',
    ];
    const text = limits.filter(Boolean).join(', ');
    return text ? `number (${text})` : 'number';
  }
  return f.type;
}

export const fieldsScreens: ScreenRegistry = {
  fields: FieldsScreen,
};
