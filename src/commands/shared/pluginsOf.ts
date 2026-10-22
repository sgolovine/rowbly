import type { Command } from 'commander';
import { programPluginRegistry } from './programPlugins';

export function pluginsOf(cmd: Command) {
  let root = cmd;
  while (root.parent) root = root.parent;
  return programPluginRegistry.get(root);
}
