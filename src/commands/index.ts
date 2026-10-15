import type { Command } from 'commander';
import { registerAssignees } from './assignees';
import { registerBoards } from './boards';
import { registerDoctor } from './doctor';
import { registerFields } from './fields';
import { registerPlugins } from './plugins';
import { registerSetup } from './setup';
import { registerStages } from './stages';
import { registerStories } from './stories';
import { registerTasks } from './tasks';

/** Registers every command area. Each area owns its own file; this registry does not change. */
export function registerCommands(program: Command): void {
  registerSetup(program);
  registerAssignees(program);
  registerBoards(program);
  registerStages(program);
  registerFields(program);
  registerStories(program);
  registerTasks(program);
  registerDoctor(program);
  registerPlugins(program);
}

export { attachPlugins, type PluginCliStager, pluginCliStager } from './plugins';
