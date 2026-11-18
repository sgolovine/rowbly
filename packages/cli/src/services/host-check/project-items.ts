import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { NotFoundError, RowblyError } from "../errors/errors.js";
import { type FactorySettings, getFactorySettings, type ModelChoice } from "../factory-settings/factory-settings.js";
import { findProject, type ServiceContext } from "../workspace/workspace.js";
import {
  type CheckEnv,
  type CheckItem,
  type CloneFinder,
  failureText,
  item,
  type ProjectFacts,
  runRemote,
  skipped,
  transportFailure,
} from "./check-item.js";

/** Counts the commits of `HEAD` in the local Project root that are not on an `origin` branch. */
export type LocalAheadCounter = (root: string) => Promise<number>;

/** The clone item, and the path of the clone for the later items. */
export interface CloneCheck {
  readonly item: CheckItem;
  readonly path: string | undefined;
}

const exec = promisify(execFile);

const NOT_IN_PROJECT = "Not in a Rowbly Project.";

/** The worker models of the settings, without duplicates: the default, the Stage and Story overrides, the tag rules. */
export function workerModels(settings: FactorySettings): ModelChoice[] {
  const stories = Object.values(settings.storyWorkerModels ?? {}).flatMap((stages) => Object.values(stages));
  const all = [
    ...(settings.workerModel ? [settings.workerModel] : []),
    ...Object.values(settings.stageWorkerModels ?? {}),
    ...stories,
    ...Object.values(settings.tagWorkerModels ?? {}),
  ];
  const keys = all.map((model) => `${model.provider}/${model.modelId}`);

  return all.filter((_model, index) => keys.indexOf(keys[index] as string) === index);
}

/** The facts of the current Project, or `undefined` outside a Project. */
export async function projectFacts(ctx: ServiceContext): Promise<ProjectFacts | undefined> {
  try {
    const { root } = await findProject(ctx);

    return { root, models: workerModels(await getFactorySettings(ctx)) };
  } catch (error) {
    if (error instanceof NotFoundError) {
      return undefined;
    }

    throw error;
  }
}

/** The `clone` item. The finder gives the path of the clone, or `undefined` when the host has no clone. */
export async function cloneItem(env: CheckEnv, finder: CloneFinder): Promise<CloneCheck> {
  if (!env.project) {
    return { item: skipped("clone", NOT_IN_PROJECT), path: undefined };
  }

  try {
    const path = await finder(env.transport, env.hostId, env.project.root);

    return path === undefined
      ? {
          item: item("clone", "fail", "The host has no clone of the Project", `Run rowbly host use ${env.hostId}.`),
          path,
        }
      : { item: item("clone", "ok", path), path };
  } catch (error) {
    if (!(error instanceof RowblyError)) {
      throw error;
    }

    return { item: transportFailure(env, "clone", error), path: undefined };
  }
}

const PUSH_ACTION =
  "Give the Git credentials of the host write access to origin, for example with gh auth setup-git on the host.";

/** The `git-push` item. A dry-run push authenticates with `origin` and writes nothing. */
export async function pushItem(env: CheckEnv, clone: string | undefined): Promise<CheckItem> {
  if (!env.project) {
    return skipped("git-push", NOT_IN_PROJECT);
  }

  if (clone === undefined) {
    return skipped("git-push", "The host has no clone of the Project.", `Run rowbly host use ${env.hostId}.`);
  }

  const outcome = await runRemote(env, [
    "env",
    "GIT_TERMINAL_PROMPT=0",
    "git",
    "-C",
    clone,
    "push",
    "--dry-run",
    "--no-verify",
    "origin",
    "HEAD:refs/heads/rowbly-push-check",
  ]);

  if (!outcome.ok) {
    return transportFailure(env, "git-push", outcome.error);
  }

  return outcome.result.exitCode === 0
    ? item("git-push", "ok", "A dry-run push to origin passes")
    : item("git-push", "fail", failureText(outcome.result), PUSH_ACTION);
}

/** Counts the local commits with Git. It never uses a shell. */
export async function countLocalAhead(root: string): Promise<number> {
  const { stdout } = await exec("git", ["-C", root, "rev-list", "--count", "HEAD", "--not", "--remotes=origin"]);

  return Number(stdout.trim());
}

async function aheadCount(counter: LocalAheadCounter, root: string): Promise<number | string> {
  try {
    return await counter(root);
  } catch (error) {
    return error instanceof Error ? (error.message.split("\n")[0] ?? "") : String(error);
  }
}

/** The `local-ahead` item. Remote worktrees start from `origin`, so local commits are a `warning`. */
export async function localAheadItem(env: CheckEnv, counter: LocalAheadCounter): Promise<CheckItem> {
  if (!env.project) {
    return skipped("local-ahead", NOT_IN_PROJECT);
  }

  const count = await aheadCount(counter, env.project.root);

  if (typeof count === "string" || Number.isNaN(count)) {
    return skipped("local-ahead", `Git cannot count the local commits: ${count}`);
  }

  return count > 0
    ? item(
        "local-ahead",
        "warning",
        `${count} local commit(s) are not on origin. Remote worktrees start from origin.`,
        "Push the local commits to origin.",
      )
    : item("local-ahead", "ok", "All local commits are on origin");
}
