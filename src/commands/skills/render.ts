import { colors, renderTable } from '../../output';
import type { SkillEntry } from '../../services';

const DESCRIPTION_WIDTH = 60;

function shorten(text: string): string {
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
