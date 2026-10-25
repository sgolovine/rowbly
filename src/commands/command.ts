import type { Command } from 'commander';
import { registerBoards } from './boards';
import { registerDoctor } from './doctor';
import { registerFields } from './fields';
import { registerPlugins } from './plugins';
import { registerSetup } from './setup';
import { registerSkills } from './skills';
import { registerStages } from './stages';
import { registerStories } from './stories';

/** Registers every command area. Each area owns a folder with commands and renderers. */
export function registerCommands(program: Command): void {
  registerSetup(program);
  registerBoards(program);
  registerStages(program);
  registerFields(program);
  registerStories(program);
  registerDoctor(program);
  registerPlugins(program);
  registerSkills(program);
}
