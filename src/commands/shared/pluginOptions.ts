import type { Command } from 'commander';
import type { PluginInput } from '../../services';
import { pluginInput } from './pluginInput';

/** `{ plugins }` for an operation's options, or `{}` when no Plugin option was used. */
export async function pluginOptions(cmd: Command): Promise<{ plugins?: PluginInput }> {
  const plugins = await pluginInput(cmd);
  return plugins ? { plugins } : {};
}
