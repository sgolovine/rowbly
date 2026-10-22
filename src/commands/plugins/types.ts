import type { Command, Option } from 'commander';
import type { ActivePlugin, PluginHost } from '../../services';
import type { AttachedPluginOptions } from '../shared';

/** Stages each Plugin's CLI part while it loads, and attaches the complete part of each that loaded. */
export interface PluginCliStager {
  /** For `LoadPluginsOptions.stage`: builds the Plugin's command group and options off the program. */
  stage(plugin: ActivePlugin): void;
  /** Attaches, in registry order, what was staged for each Plugin that is on in `host`. */
  attach(host: PluginHost): void;
}

/** One Plugin's commands and core command options, built off the program and attached in one step. */
export interface StagedCli {
  group?: Command;
  options: { path: string; command: Command; options: Option[]; attached: AttachedPluginOptions }[];
}
