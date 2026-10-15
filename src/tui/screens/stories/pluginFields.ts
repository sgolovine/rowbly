// The fields that Plugins add to the Story form and the Story filter, and how their values become
// Plugin input (`plugins: { <id>: … }`, ADR-0012). Each Plugin's callbacks run through the shared
// adapter (`invokePlugin`, ADR-0020 §5), in their stage's scope and attributed to the Plugin. Only a Plugin whose fields loaded and changed contributes
// form input, so an unchanged or failed one never changes stored data (ADR-0020 §3).
import { errorMessage, RowblyError } from '../../../core';
import type { Slug, Story } from '../../../schemas';
import {
  type Invocation,
  invokePlugin,
  invokePluginSync,
  type PluginFormField,
  type PluginFormValue,
  type PluginInput,
  type Services,
  type StoryFilter,
} from '../../../services';
import { type FormField, type FormValues, normalizeFormValue, sameFormValue } from '../../components';
import type { TuiPlugin } from '../../hooks';

const PREFIX = 'plugin:';

/** The choice that resets an `unavailable` field; the other choice keeps the stored value. */
export const RESET = 'reset';

/** The TUI stages of a Plugin's form and filter callbacks. */
export type PluginFieldStage = 'field' | 'input' | 'filter' | 'filter-summary';

/** A Plugin form or filter callback that failed. */
export interface PluginFieldFailure {
  plugin: string;
  stage: PluginFieldStage;
  message: string;
}

/** The Plugin fields of a core form. */
export interface PluginFieldSet {
  /** Named `plugin:<id>:<name>`. */
  fields: FormField[];
  /** Their starting values. */
  values: FormValues;
  /** Each Plugin whose fields loaded, with its fields as it gave them. Only these Plugins take part. */
  loaded: ReadonlyMap<string, readonly PluginFormField[]>;
  /** The Plugins whose fields failed to load; their fields are left out. */
  failures: PluginFieldFailure[];
}

export function failureMessage(failure: PluginFieldFailure): string {
  return `Plugin "${failure.plugin}" failed in the ${failure.stage} stage: ${failure.message}`;
}

/** Plugin fields are named `plugin:<id>:<name>` in a core form. */
function fieldName(id: string, name: string): string {
  return `${PREFIX}${id}:${name}`;
}

/** Plugin `id`'s values in a core form, by its own field names. */
function valuesOf(values: FormValues, id: string): Record<string, PluginFormValue> {
  const prefix = fieldName(id, '');
  return Object.fromEntries(
    Object.entries(values)
      .filter(([name]) => name.startsWith(prefix))
      .map(([name, value]) => [name.slice(prefix.length), value]),
  );
}

/** Field providers and input conversion run in the `field` stage, the filter callbacks in `filter`. */
function invocation(plugin: string, stage: PluginFieldStage, operation?: string): Invocation {
  return { plugin, stage: stage === 'field' || stage === 'input' ? 'field' : 'filter', operation };
}

/** A failed callback, shown with the Plugin's own message: the adapter keeps the original as `cause`. */
function failure(plugin: string, stage: PluginFieldStage, err: unknown): PluginFieldFailure {
  const own = err instanceof RowblyError && err.details.plugin === plugin && err.cause !== undefined ? err.cause : err;
  return { plugin, stage, message: errorMessage(own) };
}

/** A form field for one of Plugin `id`'s fields, with its starting value. */
function toFormField(id: string, field: PluginFormField): { field: FormField; value: PluginFormValue | undefined } {
  const name = fieldName(id, field.name);
  if (field.unavailable !== undefined) {
    const kept = field.unavailable;
    return { field: { name, label: field.label, kind: 'select', options: [kept, RESET] }, value: kept };
  }
  const { value, unavailable: _unavailable, ...rest } = field;
  return { field: { ...rest, name }, value };
}

/** Turns each Plugin's fields into form fields and their starting values, one Plugin at a time. */
async function collectPluginFields(
  plugins: readonly TuiPlugin[],
  load: (plugin: TuiPlugin) => Promise<PluginFormField[]> | undefined,
): Promise<PluginFieldSet> {
  const loaded = new Map<string, readonly PluginFormField[]>();
  const set: PluginFieldSet = { fields: [], values: {}, loaded, failures: [] };
  for (const plugin of plugins) {
    let own: PluginFormField[] | undefined;
    try {
      own = await invokePlugin(invocation(plugin.id, 'field'), async () => {
        const fields = await load(plugin);
        if (fields !== undefined && !Array.isArray(fields)) throw new Error('its fields are not a list');
        const names = (fields ?? []).map((field) => field.name);
        const twice = names.find((name, i) => names.indexOf(name) !== i);
        if (twice !== undefined) throw new Error(`it names two fields "${twice}"`);
        return fields;
      });
    } catch (err) {
      set.failures.push(failure(plugin.id, 'field', err));
      continue;
    }
    if (own === undefined) continue;
    loaded.set(plugin.id, own);
    for (const pluginField of own) {
      const { field, value } = toFormField(plugin.id, pluginField);
      set.fields.push(field);
      if (value !== undefined) set.values[field.name] = value;
    }
  }
  return set;
}

export function storyFormFields(
  plugins: readonly TuiPlugin[],
  services: Services,
  args: { boardId: Slug; story: Story | null },
): Promise<PluginFieldSet> {
  return collectPluginFields(plugins, (p) =>
    p.tui.storyForm?.fields({ ...args, plugin: services.plugins.context(p.id) }),
  );
}

/** What changed in one Plugin's fields, normalized, as `PluginStoryForm.input` receives it. */
function changesOf(id: string, own: readonly PluginFormField[], values: FormValues) {
  const current: Record<string, PluginFormValue> = {};
  const initialValues: Record<string, PluginFormValue> = {};
  const changedFields: string[] = [];
  for (const field of own) {
    const submitted = values[fieldName(id, field.name)];
    if (field.unavailable !== undefined) {
      if (submitted === RESET) {
        current[field.name] = null;
        changedFields.push(field.name);
      }
      continue;
    }
    const before = normalizeFormValue(field, field.value);
    const after = normalizeFormValue(field, submitted);
    initialValues[field.name] = before;
    current[field.name] = after;
    if (!sameFormValue(before, after)) changedFields.push(field.name);
  }
  return { values: current, initialValues, changedFields };
}

/**
 * The Plugin input of a submitted Story form, or `undefined` when no Plugin has any. Only Plugins in
 * `set.loaded` with a changed field are asked. A throwing `input` fails the save, attributed.
 */
export function storyFormInput(
  plugins: readonly TuiPlugin[],
  set: Pick<PluginFieldSet, 'loaded'>,
  values: FormValues,
  story: Story | null,
): PluginInput | undefined {
  return gatherPluginInput(plugins, set, (plugin) => {
    const own = set.loaded.get(plugin.id);
    const form = plugin.tui.storyForm;
    if (!own || !form) return undefined;
    const changes = changesOf(plugin.id, own, values);
    if (changes.changedFields.length === 0) return undefined;
    const operation = story ? 'stories.update' : 'stories.create';
    return invokePluginSync(invocation(plugin.id, 'input', operation), () => form.input({ ...changes, story }));
  });
}

export function storyFilterFields(
  plugins: readonly TuiPlugin[],
  services: Services,
  boardId: Slug,
): Promise<PluginFieldSet> {
  return collectPluginFields(plugins, (p) =>
    p.tui.storyFilter?.fields({ boardId, plugin: services.plugins.context(p.id) }),
  );
}

/**
 * `filter` with the Plugin filters chosen in `values`. Plugins whose filter fields failed are left
 * out, as is one whose `filter` throws, which is returned in `failures`.
 */
export function withPluginFilters(
  filter: StoryFilter,
  plugins: readonly TuiPlugin[],
  set: Pick<PluginFieldSet, 'loaded'>,
  values: FormValues,
): { filter: StoryFilter; failures: PluginFieldFailure[] } {
  const failures: PluginFieldFailure[] = [];
  const input = gatherPluginInput(plugins, set, (plugin) => {
    const storyFilter = plugin.tui.storyFilter;
    if (!storyFilter || !set.loaded.has(plugin.id)) return undefined;
    try {
      return invokePluginSync(invocation(plugin.id, 'filter'), () => storyFilter.filter(valuesOf(values, plugin.id)));
    } catch (err) {
      failures.push(failure(plugin.id, 'filter', err));
      return undefined;
    }
  });
  return { filter: input ? { ...filter, plugins: input } : filter, failures };
}

/** `summary` followed by the Plugins' parts of the one-line filter summary. */
export function describeWithPlugins(
  summary: string,
  plugins: readonly TuiPlugin[],
  set: Pick<PluginFieldSet, 'loaded'> | undefined,
  values: FormValues,
): { summary: string; failures: PluginFieldFailure[] } {
  const failures: PluginFieldFailure[] = [];
  const parts = plugins.map((plugin) => {
    const storyFilter = plugin.tui.storyFilter;
    if (!storyFilter || !set?.loaded.has(plugin.id)) return '';
    try {
      return invokePluginSync(invocation(plugin.id, 'filter-summary'), () =>
        storyFilter.describe(valuesOf(values, plugin.id)),
      );
    } catch (err) {
      failures.push(failure(plugin.id, 'filter-summary', err));
      return '';
    }
  });
  return { summary: [summary, ...parts].filter(Boolean).join(' · '), failures };
}

function gatherPluginInput(
  plugins: readonly TuiPlugin[],
  set: Pick<PluginFieldSet, 'loaded'>,
  pick: (plugin: TuiPlugin) => unknown,
): PluginInput | undefined {
  const input: PluginInput = {};
  for (const plugin of plugins) {
    if (!set.loaded.has(plugin.id)) continue;
    const value = pick(plugin);
    if (value !== undefined) input[plugin.id] = value;
  }
  return Object.keys(input).length > 0 ? input : undefined;
}
