import { dirname, join } from "node:path";
import type { ProjectConfig, SkillHarness } from "../config/config.js";
import { canCreateFolder, pathExists, pathOccupied } from "../files/files.js";
import { bundledSkills, copySkill, SKILL_FILE, skillPath } from "../skill/skill.js";
import { type DoctorIssue, type DoctorRun, noted, rel, report } from "./doctor-run.js";
import { mapInOrder } from "./map-in-order.js";

interface SkillTarget {
  readonly name: string;
  readonly harness: SkillHarness;
}

type BundledSkills = Awaited<ReturnType<typeof bundledSkills>>;

/** The reason that a missing skill cannot come back with `--fix`, if there is one. */
async function blockedMessage(
  run: DoctorRun,
  bundled: BundledSkills,
  target: SkillTarget,
  path: string,
): Promise<string | undefined> {
  const { name, harness } = target;
  const remove = `\`rowbly skill remove ${name} --harness ${harness}\``;

  if (!(await canCreateFolder(dirname(path)))) {
    return `Skill ${name} for ${harness} is missing, and Rowbly cannot create ${rel(run, dirname(path))}. Repair that path, or run ${remove}`;
  }

  if (await pathOccupied(path)) {
    return `Skill ${name} for ${harness} has no ${SKILL_FILE}. Repair the folder by hand, or delete it with ${remove}`;
  }

  if (!bundled.names.includes(name)) {
    return `Skill ${name} for ${harness} is missing, and Rowbly no longer bundles it. Run ${remove}`;
  }

  return undefined;
}

async function skillIssues(run: DoctorRun, bundled: BundledSkills, target: SkillTarget): Promise<DoctorIssue[]> {
  const { name, harness } = target;
  const path = skillPath(run.paths, harness, name);

  if (await pathExists(join(path, SKILL_FILE))) {
    return [];
  }

  const file = rel(run, path);
  const blocked = await blockedMessage(run, bundled, target, path);

  if (blocked) {
    return [noted({ severity: "error", message: blocked, file })];
  }

  return [
    await report(
      run,
      { severity: "error", message: `Skill ${name} for ${harness} is missing`, file, fix: "Install it again" },
      () => copySkill(join(bundled.dir, name), path).then(() => undefined),
    ),
  ];
}

/** `--fix` copies a skill only into an empty place: a folder that lacks `SKILL.md` can hold the work of a user. */
export async function checkSkills(run: DoctorRun, config: ProjectConfig): Promise<DoctorIssue[]> {
  if (!config.skills?.length) {
    return [];
  }

  const bundled = await bundledSkills(run.ctx);
  const targets = config.skills.flatMap(({ name, harnesses }) => harnesses.map((harness) => ({ name, harness })));

  const issues = await mapInOrder(targets, (target) => skillIssues(run, bundled, target));

  return issues.flat();
}
