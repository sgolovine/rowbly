import { isCancel, select } from '@clack/prompts';
import { type Command, Option } from 'commander';
import { UsageError } from '../../core';
import { printResult } from '../../output';
import {
  createSkill,
  HARNESS_FOLDERS,
  HARNESSES,
  type Harness,
  installSkill,
  invalidSkillName,
  listAllSkills,
  officialSkills,
} from '../../services';
import { cancelled, type GlobalOptions, globalOptions, isInteractive, promptIfMissing } from '../shared';
import { renderSkillCreated, renderSkillInstalled, renderSkillList, shorten } from './render';

export function registerSkills(program: Command): void {
  const skills = program
    .command('skills')
    .description('Install, create and list agent skills that use Rowbly')
    .addHelpText(
      'after',
      '\nSkills are installed, created and listed below the current folder. Official skills ship with Rowbly.',
    );

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
    .command('install [path]')
    .description('Install an official skill, or copy a skill folder, into a skills folder')
    .addOption(
      new Option('--harness <harness>', 'the agent whose skills folder gets the skill')
        .choices(HARNESSES)
        .default('generic'),
    )
    .addHelpText(
      'after',
      '\n<path> is a folder that holds SKILL.md, or the name of an official skill (for example `rowbly`).\n' +
        'Without it, pick an official skill from a menu.',
    )
    .action(async (path: string | undefined, opts: { harness: Harness }, cmd: Command) => {
      const globals = globalOptions(cmd);
      const source = path ?? (await pickOfficialSkill(opts.harness, globals));
      const skill = await installSkill({ cwd: process.cwd(), source, harness: opts.harness });
      printResult(skill, { json: globals.json, human: renderSkillInstalled });
    });

  skills
    .command('list')
    .description('List the official skills and the custom skills below the current folder')
    .action(async (_opts: unknown, cmd: Command) => {
      const globals = globalOptions(cmd);
      printResult(await listAllSkills(process.cwd()), { json: globals.json, human: renderSkillList });
    });
}

/** Asks which official skill to install; marks the ones already in the skills folder of `harness`. */
async function pickOfficialSkill(harness: Harness, globals: GlobalOptions): Promise<string> {
  if (!isInteractive(globals))
    throw new UsageError('missing required [path]', {
      hint: 'pass a skill folder, or the name of an official skill such as `rowbly`',
    });
  const folder = HARNESS_FOLDERS[harness];
  const installed = new Set(
    (await listAllSkills(process.cwd())).official
      .filter((skill) => skill.installed.some((at) => at.harnesses.includes(harness)))
      .map((skill) => skill.name),
  );
  const answer = await select({
    message: `Official skill to install in ${folder}`,
    options: (await officialSkills()).map((skill) => ({
      value: skill.name,
      label: installed.has(skill.name) ? `${skill.name} (installed)` : skill.name,
      hint: shorten(skill.description),
    })),
  });
  return isCancel(answer) ? cancelled() : answer;
}
