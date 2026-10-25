// Agent skills that use Rowbly: `rowbly skills create` writes one, `rowbly skills list` finds them.
// They live in an agent's skills folder below the current folder, not in a Data Root.
import { join, relative } from 'node:path';
import { ValidationError } from '../core';
import { createFolder, listFoldersWith, readPackageFile } from '../storage';

/**
 * The skills folder of each harness, relative to the folder the skill is for. These are the native
 * placements of github.com/sgolovine/distributor; Codex reads its skills from `.agents/skills`.
 */
export const HARNESS_FOLDERS = {
  generic: '.agents/skills',
  claude: '.claude/skills',
  codex: '.agents/skills',
  gemini: '.gemini/skills',
  pi: '.pi/skills',
  cursor: '.cursor/skills',
} as const;

export type Harness = keyof typeof HARNESS_FOLDERS;
export const HARNESSES = Object.keys(HARNESS_FOLDERS) as Harness[];

const REFERENCE = 'references/rowbly-reference.md';
const NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const NAME_MAX = 64;
const INTRO_MAX = 160;
const PLACEHOLDER_DESCRIPTION = 'TODO: say what this skill does and when an agent should use it.';

/** The paragraph at the top of every created skill: what Rowbly is and where its reference is. */
export const SKILL_INTRO = `This repository tracks its work in Rowbly, a file-backed Kanban CLI. Read [the Rowbly reference](${REFERENCE}) before you run \`rowbly\`.`;
if (SKILL_INTRO.length > INTRO_MAX) throw new Error(`SKILL_INTRO is longer than ${INTRO_MAX} characters`);

/** A skill that `rowbly skills create` made, or any skill that carries the Rowbly reference. */
export interface SkillEntry {
  name: string;
  description: string;
  /** The harnesses that read this skill's folder. */
  harnesses: Harness[];
  /** The skill folder, relative to the folder that was searched. */
  path: string;
}

export interface CreateSkillInput {
  /** The folder the skill is for; its harness folder is created below it. */
  cwd: string;
  name: string;
  harness: Harness;
  description?: string;
}

/** The message when `name` is not a valid skill name, else `undefined`. */
export function invalidSkillName(name: string): string | undefined {
  if (!NAME.test(name)) return 'use lowercase letters, digits and single hyphens, for example `release-notes`';
  if (name.length > NAME_MAX) return `use at most ${NAME_MAX} characters`;
  return undefined;
}

/** Writes `SKILL.md` and the Rowbly reference into a new skill folder for `harness`. */
export async function createSkill(input: CreateSkillInput): Promise<SkillEntry> {
  const problem = invalidSkillName(input.name);
  if (problem) throw new ValidationError(`invalid skill name "${input.name}"`, { hint: problem });
  const description = input.description?.trim() || PLACEHOLDER_DESCRIPTION;
  const folder = HARNESS_FOLDERS[input.harness];
  const dir = join(input.cwd, folder, input.name);
  await createFolder(dir, { 'SKILL.md': skillText(input.name, description), [REFERENCE]: await reference() });
  return { name: input.name, description, harnesses: harnessesOf(folder), path: relative(input.cwd, dir) };
}

/** The skills below `cwd` that carry the Rowbly reference, one entry per skill folder. */
export async function listSkills(cwd: string): Promise<SkillEntry[]> {
  const entries: SkillEntry[] = [];
  for (const folder of new Set(Object.values(HARNESS_FOLDERS))) {
    for (const { name, text } of await listFoldersWith(join(cwd, folder), ['SKILL.md', REFERENCE])) {
      entries.push({
        name,
        description: descriptionOf(text),
        harnesses: harnessesOf(folder),
        path: join(folder, name),
      });
    }
  }
  return entries;
}

function harnessesOf(folder: string): Harness[] {
  return HARNESSES.filter((h) => HARNESS_FOLDERS[h] === folder);
}

function reference(): Promise<string> {
  return readPackageFile('skills/rowbly-reference.md');
}

function skillText(name: string, description: string): string {
  return [
    '---',
    `name: ${name}`,
    `description: ${JSON.stringify(description)}`,
    '---',
    '',
    `# ${name}`,
    '',
    SKILL_INTRO,
    '',
    '<!-- Write the steps of this skill here. -->',
    '',
  ].join('\n');
}

/** The `description` of a `SKILL.md` frontmatter, or `''`. */
function descriptionOf(text: string): string {
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] ?? '';
  const raw = /^description:\s*(.*)$/m.exec(frontmatter)?.[1]?.trim() ?? '';
  if (raw.startsWith('"')) {
    try {
      return String(JSON.parse(raw));
    } catch {
      return raw;
    }
  }
  return raw.replace(/^'(.*)'$/, '$1');
}
