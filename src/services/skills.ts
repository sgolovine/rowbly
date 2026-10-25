// Agent skills that use Rowbly: `rowbly skills create` writes one, `rowbly skills install` copies one
// in (an official skill shipped in the Rowbly package, or any skill folder), `rowbly skills list`
// finds them. They live in an agent's skills folder below the current folder, not in a Data Root.
import { basename, join, relative, resolve } from 'node:path';
import { NotFoundError, ValidationError } from '../core';
import {
  copyFolder,
  createFolder,
  isFolder,
  listFoldersWith,
  packagePath,
  pathExists,
  readPackageFile,
  readTextFile,
} from '../storage';

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

/** A skill shipped in the Rowbly package's `skills/` folder, and where it is installed below a folder. */
export interface OfficialSkill {
  name: string;
  description: string;
  /** The skill folders below the searched folder that hold it, one entry per folder. */
  installed: { harnesses: Harness[]; path: string }[];
}

/** `rowbly skills list`: the official skills, then the other skills that carry the Rowbly reference. */
export interface SkillList {
  official: OfficialSkill[];
  custom: SkillEntry[];
}

/** A skill that `rowbly skills install` copied in. */
export interface InstalledSkill extends SkillEntry {
  /** Whether the skill is one of the official skills shipped in the Rowbly package. */
  official: boolean;
}

export interface InstallSkillInput {
  /** The folder the skill is for; its harness folder is created below it. */
  cwd: string;
  /** A skill folder (relative to `cwd`), or the name of an official skill. */
  source: string;
  harness: Harness;
}

/** The official skills, shipped as folders with a `SKILL.md` in the package's `skills/` folder. */
export async function officialSkills(): Promise<{ name: string; description: string; dir: string }[]> {
  const root = await packagePath('skills');
  return (await listFoldersWith(root, ['SKILL.md'])).map(({ name, text }) => ({
    name,
    description: descriptionOf(text),
    dir: join(root, name),
  }));
}

/**
 * Copies a skill folder into the skills folder of `harness`. `source` is a folder that holds
 * `SKILL.md`, or, when no such path exists, the name of an official skill. The skill keeps the
 * `name` of its `SKILL.md` frontmatter, else its folder name.
 */
export async function installSkill(input: InstallSkillInput): Promise<InstalledSkill> {
  const official = await officialSkills();
  const sourceDir = resolve(input.cwd, input.source);
  let dir: string;
  if (await pathExists(sourceDir)) {
    if (!(await isFolder(sourceDir)) || !(await pathExists(join(sourceDir, 'SKILL.md'))))
      throw new ValidationError(`${input.source} is not a skill folder`, {
        hint: 'pass a folder that holds SKILL.md, or the name of an official skill',
      });
    dir = sourceDir;
  } else {
    const match = official.find((skill) => skill.name === input.source);
    if (!match)
      throw new NotFoundError(`no skill folder or official skill named "${input.source}"`, {
        hint: `official skills: ${official.map((skill) => skill.name).join(', ')}`,
      });
    dir = match.dir;
  }
  const text = await readTextFile(join(dir, 'SKILL.md'));
  const name = frontmatterField(text, 'name') || basename(dir);
  const problem = invalidSkillName(name);
  if (problem) throw new ValidationError(`invalid skill name "${name}"`, { hint: problem });
  const folder = HARNESS_FOLDERS[input.harness];
  const target = join(input.cwd, folder, name);
  await copyFolder(dir, target);
  return {
    name,
    description: descriptionOf(text),
    harnesses: harnessesOf(folder),
    path: relative(input.cwd, target),
    official: official.some((skill) => skill.name === name),
  };
}

/**
 * The official skills with where each is installed below `cwd`, and the custom skills: the other
 * skills below `cwd` that carry the Rowbly reference.
 */
export async function listAllSkills(cwd: string): Promise<SkillList> {
  const folders = [...new Set(Object.values(HARNESS_FOLDERS))];
  const official: OfficialSkill[] = [];
  for (const skill of await officialSkills()) {
    const installed: OfficialSkill['installed'] = [];
    for (const folder of folders) {
      if (await pathExists(join(cwd, folder, skill.name, 'SKILL.md')))
        installed.push({ harnesses: harnessesOf(folder), path: join(folder, skill.name) });
    }
    official.push({ name: skill.name, description: skill.description, installed });
  }
  const names = new Set(official.map((skill) => skill.name));
  const custom = (await listSkills(cwd)).filter((skill) => !names.has(skill.name));
  return { official, custom };
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
  return frontmatterField(text, 'description');
}

/**
 * A field of a `SKILL.md` frontmatter, unquoted, or `''`. A value that goes on over indented lines
 * (as `skills/rowbly/SKILL.md` writes its description) is folded into one line, as YAML does.
 */
function frontmatterField(text: string, field: string): string {
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] ?? '';
  const value = new RegExp(`^${field}:[ \\t]*(.*(?:\\r?\\n[ \\t]+.*)*)`, 'm').exec(frontmatter)?.[1] ?? '';
  const raw = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .join(' ')
    .trim();
  if (raw.startsWith('"')) {
    try {
      return String(JSON.parse(raw));
    } catch {
      return raw;
    }
  }
  return raw.replace(/^'(.*)'$/, '$1');
}
