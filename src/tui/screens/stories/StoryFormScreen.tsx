import { homedir } from 'node:os';
import { Box, Text } from 'ink';
import { type CustomFieldDef, type CustomFieldValue, PrioritySchema, type Story } from '../../../schemas';
import { type CustomFieldValuesInput, type PluginInput, readOpenStoryAfterCreation } from '../../../services';
import { type StoryChoices, storyChoices } from '../../../services/stories';
import { Form, type FormField, type FormValue, type FormValues, Loading } from '../../components';
import { useAsync, usePlugins, useRowblyContext, useServices, useToast } from '../../hooks';
import { useRouter } from '../../router';
import { theme } from '../../theme';
import type { ScreenProps } from '../types';
import { PluginFailures } from './PluginFailures';
import { onPluginFields, storyFormFields, storyFormInput } from './pluginFields';
import { boardIdFor, NONE } from './shared';
import { priorityValue } from './storyFormValues';

/**
 * Creates a Story (`params.boardId`, default: the Board in context; `params.stage` presets the Stage) or edits one
 * (`params.key`). A new Story opens when Open Story after creation is on in Preferences.
 */
export function StoryFormScreen({ params }: ScreenProps) {
  const services = useServices();
  const ctx = useRowblyContext();
  const toast = useToast();
  const router = useRouter();
  const { plugins } = usePlugins();
  const key = params.key as string | undefined;
  const data = useAsync(async () => {
    const story = key ? await services.stories.get(key) : null;
    const boardId = story ? story.boardId : await boardIdFor(services, params);
    if (!ctx) throw new Error('no Data Root');
    const extra = await storyFormFields(plugins, services, { boardId, story });
    return { story, boardId, choices: await storyChoices(ctx, boardId), extra };
  }, [services, ctx, key, params.boardId, plugins]);

  if (!data.data)
    return data.loading ? <Loading label="Loading…" /> : <Text color={theme.danger}>Cannot open the form.</Text>;
  const { story, boardId, choices, extra } = data.data;

  // A Plugin's invalid input shows on that Plugin's fields (DX-07).
  const submit = (values: FormValues) =>
    save(values).catch((err: unknown) => {
      throw onPluginFields(err, extra);
    });

  const save = async (values: FormValues) => {
    const fields = customFieldValues(choices.customFields, values);
    const common = {
      name: String(values.name),
      description: String(values.description ?? ''),
      priority: priorityValue(values.priority),
      labels: splitList(values.labels),
      dueDate: optional(values.dueDate),
      ...pluginInputOptions(storyFormInput(plugins, extra, values, story)),
    };
    const stage = String(values.stage);
    if (!story) {
      const created = await services.stories.create(boardId, { ...common, stage, customFields: fields });
      toast.push('info', `Created ${created.key}`);
      // Back to the Board or list, which reloads on return, unless the user opens new Stories.
      // The Story is saved, so an unreadable Home Config counts as off rather than an error.
      const open = await readOpenStoryAfterCreation(ctx?.home ?? homedir()).catch(() => false);
      if (open) router.replace('story', { key: created.key, title: created.key });
      else router.pop();
      return;
    }
    const unsetFields = Object.keys(story.customFields).filter((k) => fields[k] === undefined);
    // One operation, so a rejected Stage change saves none of the edit (ARCH-43).
    await services.stories.update(story.key, { ...common, stage, customFields: fields, unsetFields });
    toast.push('info', `Updated ${story.key}`);
    router.pop();
  };

  return (
    <Box flexDirection="column" gap={1}>
      <Text bold>{story ? `Edit ${story.key}` : `New Story on ${boardId}`}</Text>
      <Form
        fields={[...formFields(choices), ...extra.fields]}
        initialValues={{ ...initialValues(choices, story, params.stage as string | undefined), ...extra.values }}
        onSubmit={submit}
      />
      <PluginFailures failures={extra.failures} note="its fields are unavailable; stored data kept" />
      {choices.labels.length > 0 && <Text color={theme.inkFaint}>Labels in use: {choices.labels.join(', ')}</Text>}
    </Box>
  );
}

function formFields(choices: StoryChoices): FormField[] {
  return [
    { name: 'name', label: 'Name', kind: 'text', required: true },
    { name: 'description', label: 'Description', kind: 'multiline' },
    {
      name: 'stage',
      label: 'Stage',
      kind: 'select',
      required: true,
      options: choices.stages.map((s) => s.key),
      optionLabels: Object.fromEntries(choices.stages.map((s) => [s.key, s.name])),
    },
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

/** `{ plugins }` for the operation, or `{}` when no Plugin gave input (CQ-14). */
function pluginInputOptions(plugins: PluginInput | undefined): { plugins?: PluginInput } {
  return plugins ? { plugins } : {};
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
