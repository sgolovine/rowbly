import type { Command } from 'commander';
import type { PluginInput } from '../../services';
import { pluginInput } from './pluginInput';

/** `{ plugins }` for an operation's options, or `{}` when no Plugin option was used. */
export function pluginOptions(cmd: Command): { plugins?: PluginInput } {
  const plugins = pluginInput(cmd);
  return plugins ? { plugins } : {};
}
