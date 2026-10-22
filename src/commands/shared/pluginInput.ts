import type { Command } from 'commander';
import type { PluginInput, PluginOptionValues } from '../../services';
import { invokePluginSync } from '../../services';
import { commandPath } from './commandPath';
import { pluginsOf } from './pluginsOf';

export function pluginInput(cmd: Command): PluginInput | undefined {
  const opts = cmd.opts<PluginOptionValues>();
  const given = (name: string) => (cmd.getOptionValueSource(name) === 'cli' ? opts[name] : undefined);
  const input: PluginInput = {};
  for (const { id, attributes, convert } of pluginsOf(cmd)?.options.get(commandPath(cmd)) ?? []) {
    const values: PluginOptionValues = Object.fromEntries(attributes.map((name) => [name, given(name)]));
    const value = invokePluginSync({ plugin: id, stage: 'option-input' }, () => convert(values));
    if (value !== undefined) input[id] = value;
  }
  return Object.keys(input).length > 0 ? input : undefined;
}
