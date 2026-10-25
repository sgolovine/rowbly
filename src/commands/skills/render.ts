import { colors, renderTable } from '../../output';
import type { InstalledSkill, SkillEntry, SkillList } from '../../services';

const DESCRIPTION_WIDTH = 48;

export function shorten(text: string): string {
  return text.length > DESCRIPTION_WIDTH ? `${text.slice(0, DESCRIPTION_WIDTH - 1)}…` : text;
}

export function renderSkills(skills: SkillEntry[]): string {
  if (skills.length === 0) return colors.dim('No skills here yet; run `rowbly skills create <name>` to make one.');
  return renderTable(
    ['NAME', 'HARNESS', 'PATH', 'DESCRIPTION'],
    skills.map((s) => [s.name, s.harnesses.join(', '), s.path, shorten(s.description)]),
  );
}

export function renderSkillCreated(skill: SkillEntry): string {
  return [
    `Created skill ${colors.bold(skill.name)} in ${skill.path}`,
    colors.dim(`Write its steps in ${skill.path}/SKILL.md.`),
  ].join('\n');
}

export function renderSkillList(list: SkillList): string {
  const official =
    list.official.length === 0
      ? colors.dim('This version of Rowbly ships no official skills.')
      : renderTable(
          ['NAME', 'INSTALLED', 'DESCRIPTION'],
          list.official.map((s) => [
            s.name,
            s.installed.length === 0
              ? colors.dim('not installed')
              : s.installed.map((at) => `${at.path} (${at.harnesses.join(', ')})`).join('\n'),
            shorten(s.description),
          ]),
        );
  const lines = [colors.bold('Official skills'), official];
  if (list.official.some((s) => s.installed.length === 0))
    lines.push(colors.dim('Run `rowbly skills install` to install one.'));
  lines.push('', colors.bold('Custom skills'), renderSkills(list.custom));
  return lines.join('\n');
}

export function renderSkillInstalled(skill: InstalledSkill): string {
  return `Installed ${skill.official ? 'official ' : ''}skill ${colors.bold(skill.name)} in ${skill.path}`;
}
