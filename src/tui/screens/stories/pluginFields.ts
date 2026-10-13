// The fields that Plugins add to the Story form and the Story filter, and how their values become
// Plugin input (`plugins: { <id>: … }`, ADR-0012).
import type { Slug, Story } from '../../../schemas';
import type { PluginFormField, PluginFormValue, PluginInput, Services, StoryFilter } from '../../../services';
import type { FormField, FormValues } from '../../components';
import type { TuiPlugin } from '../../hooks';

const PREFIX = 'plugin:';

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

/** Turns each Plugin's fields into form fields and their starting values. */
async function collect(
  plugins: readonly TuiPlugin[],
  load: (plugin: TuiPlugin) => Promise<PluginFormField[]> | undefined,
): Promise<{ fields: FormField[]; values: FormValues }> {
  const fields: FormField[] = [];
  const values: FormValues = {};
  for (const plugin of plugins) {
    for (const field of (await load(plugin)) ?? []) {
      const name = fieldName(plugin.id, field.name);
      fields.push({ ...field, name });
      if (field.value !== undefined) values[name] = field.value;
    }
  }
  return { fields, values };
}

export function storyFormFields(
  plugins: readonly TuiPlugin[],
  services: Services,
  args: { boardId: Slug; story: Story | null },
): Promise<{ fields: FormField[]; values: FormValues }> {
  return collect(plugins, (p) => p.tui.storyForm?.fields({ ...args, plugin: services.plugins.context(p.id) }));
}

/** The Plugin input of a submitted Story form, or `undefined` when no Plugin has any. */
export function storyFormInput(
  plugins: readonly TuiPlugin[],
  values: FormValues,
  story: Story | null,
): PluginInput | undefined {
  return gather(plugins, (p) => p.tui.storyForm?.input(valuesOf(values, p.id), story));
}

export function storyFilterFields(
  plugins: readonly TuiPlugin[],
  services: Services,
  boardId: Slug,
): Promise<{ fields: FormField[]; values: FormValues }> {
  return collect(plugins, (p) => p.tui.storyFilter?.fields({ boardId, plugin: services.plugins.context(p.id) }));
}

/** `StoryFilter.plugins` for the chosen filter values, or `undefined` when no Plugin filters. */
function storyFilterInput(plugins: readonly TuiPlugin[], values: FormValues): PluginInput | undefined {
  return gather(plugins, (p) => p.tui.storyFilter?.filter(valuesOf(values, p.id)));
}

/** `filter` with the Plugin filters chosen in `values`. */
export function withPluginFilters(filter: StoryFilter, plugins: readonly TuiPlugin[], values: FormValues): StoryFilter {
  const input = storyFilterInput(plugins, values);
  return input ? { ...filter, plugins: input } : filter;
}

/** `summary` followed by the Plugins' parts of the one-line filter summary. */
export function describeWithPlugins(summary: string, plugins: readonly TuiPlugin[], values: FormValues): string {
  const parts = plugins.map((p) => p.tui.storyFilter?.describe(valuesOf(values, p.id)) ?? '');
  return [summary, ...parts].filter(Boolean).join(' · ');
}

function gather(plugins: readonly TuiPlugin[], pick: (plugin: TuiPlugin) => unknown): PluginInput | undefined {
  const input: PluginInput = {};
  for (const plugin of plugins) {
    const value = pick(plugin);
    if (value !== undefined) input[plugin.id] = value;
  }
  return Object.keys(input).length > 0 ? input : undefined;
}
