import { Box, Text } from 'ink';
import {
  type CustomFieldDef,
  type CustomFieldValue,
  type Priority,
  PrioritySchema,
  type Story,
} from '../../../schemas';
import type { CustomFieldValuesInput } from '../../../services';
import { type StoryChoices, storyChoices } from '../../../services/stories';
import { Form, type FormField, type FormValue, type FormValues, Loading } from '../../components';
import { useAsync, useKeyHints, useRowblyContext, useServices, useToast } from '../../hooks';
import { useRouter } from '../../router';
import type { ScreenProps } from '../types';
import { boardIdFor, NONE } from './shared';

/** Creates a Story (`params.boardId`, default: the Board in context; `params.stage` presets the Stage) or edits one (`params.key`). */
export function StoryFormScreen({ params }: ScreenProps) {
  const services = useServices();
  const ctx = useRowblyContext();
  const toast = useToast();
  const router = useRouter();
  const key = params.key as string | undefined;
  const data = useAsync(async () => {
    const story = key ? await services.stories.get(key) : null;
    const boardId = story ? story.boardId : await boardIdFor(services, params);
    if (!ctx) throw new Error('no Data Root');
    return { story, boardId, choices: await storyChoices(ctx, boardId) };
  }, [services, ctx, key, params.boardId]);
  useKeyHints([
    { key: 'enter', description: 'save' },
    { key: 'e', description: 'edit description' },
  ]);

  if (!data.data) return data.loading ? <Loading label="Loading…" /> : <Text color="red">Cannot open the form.</Text>;
  const { story, boardId, choices } = data.data;

  const submit = async (values: FormValues) => {
    const fields = customFieldValues(choices.customFields, values);
    const common = {
      name: String(values.name),
      description: String(values.description ?? ''),
      assignees: (values.assignees as string[] | null) ?? [],
      priority: optional(values.priority) as Priority | null,
      labels: splitList(values.labels),
      dueDate: optional(values.dueDate),
    };
    const stage = String(values.stage);
    if (!story) {
      const created = await services.stories.create(boardId, { ...common, stage, customFields: fields });
      toast.push('info', `Created ${created.key}`);
      router.replace('story', { key: created.key, title: created.key });
      return;
    }
    const unsetFields = Object.keys(story.customFields).filter((k) => fields[k] === undefined);
    await services.stories.update(story.key, { ...common, customFields: fields, unsetFields });
    if (stage !== story.stage) await services.stories.move(story.key, stage);
    toast.push('info', `Updated ${story.key}`);
    router.pop();
  };

  return (
    <Box flexDirection="column" gap={1}>
      <Text bold>{story ? `Edit ${story.key}` : `New Story on ${boardId}`}</Text>
      <Form
        fields={formFields(choices)}
        initialValues={initialValues(choices, story, params.stage as string | undefined)}
        onSubmit={submit}
      />
      {choices.labels.length > 0 && <Text dimColor>Labels in use: {choices.labels.join(', ')}</Text>}
    </Box>
  );
}

function formFields(choices: StoryChoices): FormField[] {
  return [
    { name: 'name', label: 'Name', kind: 'text', required: true },
    { name: 'description', label: 'Description', kind: 'multiline' },
    { name: 'stage', label: 'Stage', kind: 'select', required: true, options: choices.stages.map((s) => s.key) },
    { name: 'assignees', label: 'Assignees', kind: 'multiselect', options: choices.assignees.map((a) => a.handle) },
    { name: 'priority', label: 'Priority', kind: 'select', options: [NONE, ...PrioritySchema.options] },
    { name: 'labels', label: 'Labels (a,b)', kind: 'text' },
    { name: 'dueDate', label: 'Due', kind: 'date' },
    ...choices.customFields.map(customFormField),
  ];
}

/** Custom Field inputs are named `cf:<key>`. Booleans and optional selects offer `(none)` to leave them unset. */
function customFormField(def: CustomFieldDef): FormField {
  const base = { name: `cf:${def.key}`, label: def.name, required: def.required };
  const unset = def.required ? [] : [NONE];
  switch (def.type) {
    case 'number':
      return { ...base, kind: 'number' };
    case 'date':
      return { ...base, kind: 'date' };
    case 'boolean':
      return { ...base, kind: 'select', options: [...unset, 'true', 'false'] };
    case 'select':
      return { ...base, kind: 'select', options: [...unset, ...def.options] };
    case 'multiselect':
      return { ...base, kind: 'multiselect', options: def.options };
    default:
      return { ...base, kind: 'text' };
  }
}

function initialValues(choices: StoryChoices, story: Story | null, stage?: string): FormValues {
  const values: FormValues = {
    name: story?.name ?? '',
    description: story?.description ?? '',
    stage: story?.stage ?? stage ?? choices.stages[0]?.key ?? null,
    assignees: story?.assignees ?? [],
    priority: story?.priority ?? NONE,
    labels: story?.labels.join(',') ?? '',
    dueDate: story?.dueDate ?? null,
  };
  for (const def of choices.customFields) {
    const value = story?.customFields[def.key];
    values[`cf:${def.key}`] =
      value === undefined ? (def.required || def.type === 'multiselect' ? null : NONE) : toFormValue(value);
  }
  return values;
}

function toFormValue(value: CustomFieldValue): FormValue {
  return typeof value === 'boolean' ? String(value) : value;
}

/** Form values → Custom Field values; empty inputs are left out. Strings are coerced by the service. */
function customFieldValues(defs: readonly CustomFieldDef[], values: FormValues): CustomFieldValuesInput {
  const result: CustomFieldValuesInput = {};
  for (const def of defs) {
    const value = values[`cf:${def.key}`];
    if (value === null || value === undefined || value === '' || value === NONE) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    result[def.key] = value as CustomFieldValue;
  }
  return result;
}

function optional(value: FormValue | undefined): string | null {
  return value === null || value === undefined || value === '' || value === NONE ? null : String(value);
}

function splitList(value: FormValue | undefined): string[] {
  return String(value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}
