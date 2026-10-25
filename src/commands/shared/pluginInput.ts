import type { Command } from 'commander';
import { UsageError } from '../../core';
import type { PluginInput, PluginOptionValues } from '../../services';
import { invokePlugin } from '../../services';
import { commandPath } from './commandPath';
import { pluginsOf } from './pluginsOf';
import { readLongText } from './readLongText';

export async function pluginInput(cmd: Command): Promise<PluginInput | undefined> {
  const opts = cmd.opts<PluginOptionValues>();
  const given = (name: string) => (cmd.getOptionValueSource(name) === 'cli' ? opts[name] : undefined);
  const input: PluginInput = {};
  let stdinUsed = cmd.opts<{ descriptionFile?: string }>().descriptionFile === '-';
  const host = {
    readText: (flags: Parameters<typeof readLongText>[0], options: Parameters<typeof readLongText>[1]) => {
      if (flags.file === '-') {
        if (stdinUsed) throw new UsageError('stdin (-) may be used only once, including the Story description');
        stdinUsed = true;
      }
      return readLongText(flags, options);
    },
  };
  for (const { id, attributes, convert } of pluginsOf(cmd)?.options.get(commandPath(cmd)) ?? []) {
    const values: PluginOptionValues = Object.fromEntries(attributes.map((name) => [name, given(name)]));
    const value = await invokePlugin({ plugin: id, stage: 'option-input' }, () => convert(values, host));
    if (value !== undefined) input[id] = value;
  }
  return Object.keys(input).length > 0 ? input : undefined;
}
