import type { Command } from 'commander';
import type { PluginHost, PluginOptionHost, PluginOptionValues } from '../../services';

export interface AttachedPluginOptions {
  id: string;
  /** The Commander attribute names of its options, e.g. `epic`. */
  attributes: string[];
  /** Its `input` (operation input) or, on `stories list`, its `filter` (criteria). */
  convert(values: PluginOptionValues, host: PluginOptionHost): unknown;
}

export interface ProgramPlugins {
  host: PluginHost;
  options: Map<string, AttachedPluginOptions[]>;
}

export const programPluginRegistry = new WeakMap<Command, ProgramPlugins>();

export function setProgramPlugins(program: Command, plugins: ProgramPlugins): void {
  programPluginRegistry.set(program, plugins);
}
