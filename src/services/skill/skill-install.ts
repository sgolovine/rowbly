import { rm } from "node:fs/promises";
import { join, relative } from "node:path";
import { type ProjectConfig, readConfig, type SkillHarness, writeConfig } from "../config/config.js";
import { ConflictError, NotFoundError } from "../errors/errors.js";
import { pathExists, pathOccupied } from "../files/files.js";
import { Store, withMember } from "../store/store.js";
import { findProject, type ProjectPaths, type ServiceContext } from "../workspace/workspace.js";
import { bundledSkills, copySkill } from "./bundled-skills.js";
import { mapInOrder } from "./map-in-order.js";
import { findSkill, parseHarnesses, trackHarnesses } from "./skill-config.js";
import { harnessSkillsDir, physicalPath, SKILL_FILE, skillPath } from "./skill-paths.js";

export interface InstallSkillInput {
  name: string;
  harnesses: string[];
}

interface SkillInstallation {
  harness: SkillHarness;
  path: string;
  /** `shared`: the folder of another tracked harness is the same folder, so Rowbly copied nothing. */
  status: "installed" | "shared" | "already-installed";
}

export interface InstallSkillResult {
  name: string;
  harnesses: SkillInstallation[];
}

/** What is at the skill path of one harness before the install. */
interface HarnessTarget {
  readonly harness: SkillHarness;
  readonly path: string;
  readonly dir: string;
  readonly installed: boolean;
  readonly occupied: boolean;
}

/** The facts that do not change while the plan grows. */
interface PlanEnv {
  readonly root: string;
  readonly tracked: readonly SkillHarness[];
  readonly trackedDirs: ReadonlySet<string>;
}

interface InstallPlan {
  readonly results: readonly SkillInstallation[];
  readonly copies: readonly string[];
  readonly conflicts: readonly string[];
  /** The skills folders that a planned copy fills. A later harness with the same folder shares the copy. */
  readonly claimedDirs: ReadonlySet<string>;
}

const EMPTY_PLAN: InstallPlan = { results: [], copies: [], conflicts: [], claimedDirs: new Set() };

async function inspectTarget(paths: ProjectPaths, harness: SkillHarness, name: string): Promise<HarnessTarget> {
  const path = skillPath(paths, harness, name);
  const dir = await physicalPath(harnessSkillsDir(paths, harness));
  const installed = await pathExists(join(path, SKILL_FILE));
  const occupied = !installed && (await pathOccupied(path));

  return { harness, path, dir, installed, occupied };
}

function withResult(plan: InstallPlan, target: HarnessTarget, status: SkillInstallation["status"]): InstallPlan {
  return { ...plan, results: [...plan.results, { harness: target.harness, path: target.path, status }] };
}

function withConflict(env: PlanEnv, plan: InstallPlan, target: HarnessTarget): InstallPlan {
  return { ...plan, conflicts: [...plan.conflicts, relative(env.root, target.path)] };
}

/** A copy of the skill is already at the path. It is a conflict when no tracked harness owns it. */
function planInstalled(env: PlanEnv, plan: InstallPlan, target: HarnessTarget): InstallPlan {
  if (env.tracked.includes(target.harness)) {
    return withResult(plan, target, "already-installed");
  }

  if (env.trackedDirs.has(target.dir)) {
    return withResult(plan, target, "shared");
  }

  return withConflict(env, plan, target);
}

function planTarget(env: PlanEnv, plan: InstallPlan, target: HarnessTarget): InstallPlan {
  if (target.installed) {
    return planInstalled(env, plan, target);
  }

  if (target.occupied) {
    return withConflict(env, plan, target);
  }

  if (plan.claimedDirs.has(target.dir)) {
    return withResult(plan, target, "shared");
  }

  return {
    ...withResult(plan, target, "installed"),
    copies: [...plan.copies, target.path],
    claimedDirs: withMember(plan.claimedDirs, target.dir),
  };
}

/** Copies the skill and tracks the new harnesses. A failure deletes each copy that it made. */
async function applyInstall(
  paths: ProjectPaths,
  config: ProjectConfig,
  source: string,
  name: string,
  copies: readonly string[],
  added: SkillHarness[],
): Promise<void> {
  const undo = new Store<{ readonly paths: readonly string[] }>({ paths: [] });

  try {
    for (const path of copies) {
      const created = await copySkill(join(source, name), path);

      undo.update((state) => ({ paths: [...state.paths, created] }));
    }

    if (added.length > 0) {
      await writeConfig(paths, trackHarnesses(config, name, added));
    }
  } catch (error) {
    await Promise.all(undo.current.paths.map((path) => rm(path, { recursive: true, force: true })));
    throw error;
  }
}

/** Installs a bundled skill for each harness. Any conflict stops the install before it writes anything. */
export async function installSkill(input: InstallSkillInput, ctx: ServiceContext = {}): Promise<InstallSkillResult> {
  const paths = await findProject(ctx);
  const config = await readConfig(paths);
  const { name } = input;
  const bundled = await bundledSkills(ctx);

  if (!bundled.names.includes(name)) {
    throw new NotFoundError(`Unknown skill "${name}"`, {
      hint: bundled.names.length > 0 ? `Bundled skills: ${bundled.names.join(", ")}` : "Rowbly has no bundled skills.",
    });
  }

  const harnesses = parseHarnesses(input.harnesses);
  const tracked = findSkill(config, name)?.harnesses ?? [];
  const trackedDirs = new Set(await Promise.all(tracked.map((h) => physicalPath(harnessSkillsDir(paths, h)))));
  const targets = await mapInOrder(harnesses, (harness) => inspectTarget(paths, harness, name));

  const env: PlanEnv = { root: paths.root, tracked, trackedDirs };
  const plan = targets.reduce((current, target) => planTarget(env, current, target), EMPTY_PLAN);

  if (plan.conflicts.length > 0) {
    throw new ConflictError(
      `${plan.conflicts.join(", ")} already exists, and it is not an installed copy of the skill`,
      {
        details: { conflicts: plan.conflicts },
        hint: "Move or delete it, then run `rowbly skill install` again.",
      },
    );
  }

  const added = harnesses.filter((harness) => !tracked.includes(harness));

  await applyInstall(paths, config, bundled.dir, name, plan.copies, added);

  return { name, harnesses: [...plan.results] };
}
