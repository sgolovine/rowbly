import { type Command, Option } from 'commander';
import { printResult } from '../../output';
import { createSkill, HARNESSES, type Harness, invalidSkillName, listSkills } from '../../services';
import { globalOptions, promptIfMissing } from '../shared';
import { renderSkillCreated, renderSkills } from './render';

export function registerSkills(program: Command): void {
  const skills = program
    .command('skills')
    .description('Create agent skills that use Rowbly, and list them')
    .addHelpText('after', '\nSkills are created and listed below the current folder.');

  skills
    .command('create [name]')
    .description('Create a skill that holds the Rowbly reference, ready for its steps')
    .addOption(
      new Option('--harness <harness>', 'the agent whose skills folder gets the skill')
        .choices(HARNESSES)
        .default('generic'),
    )
    .option('--description <text>', 'when an agent should use the skill (the SKILL.md description)')
    .addHelpText(
      'after',
      '\nSkills folders: generic and codex .agents/skills, claude .claude/skills, gemini .gemini/skills,\n' +
        'pi .pi/skills, cursor .cursor/skills.',
    )
    .action(async (name: string | undefined, opts: { harness: Harness; description?: string }, cmd: Command) => {
      const globals = globalOptions(cmd);
      const skillName = await promptIfMissing(name, globals, {
        flag: '<name>',
        message: 'Skill name',
        validate: invalidSkillName,
      });
      const skill = await createSkill({
        cwd: process.cwd(),
        name: skillName,
        harness: opts.harness,
        description: opts.description,
      });
      printResult(skill, { json: globals.json, human: renderSkillCreated });
    });

  skills
    .command('list')
    .description('List the skills below the current folder that hold the Rowbly reference')
    .action(async (_opts: unknown, cmd: Command) => {
      const globals = globalOptions(cmd);
      printResult(await listSkills(process.cwd()), { json: globals.json, human: renderSkills });
    });
}
