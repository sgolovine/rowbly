import { type ProjectConfig, readConfig, writeConfig } from "../config/config.js";
import { ConflictError, ValidationError } from "../errors/errors.js";
import { pathExists } from "../files/files.js";
import { refuseRemoteWrite } from "../outbox/outbox.js";
import { findProject, type ProjectPaths, type ServiceContext } from "../workspace/workspace.js";
import { assertChecks, checkLimits, validChecks } from "./check-settings.js";
import { validDependencies } from "./dependency-settings.js";
import type { FactorySettings, FactorySettingsInput } from "./factory-settings.js";
import { type GitSync, gitSync, MAX_SYNC_SECONDS, MIN_SYNC_SECONDS, validGit } from "./git-settings.js";
import { isRecord, validFallbacks, validModel, validOverrides } from "./model-settings.js";
import { DEFAULT_PLACEMENT, validPlacement } from "./placement-settings.js";
import { validStageClasses } from "./stage-classes.js";

const DEFAULT_SETTINGS: FactorySettings = { maxWorkers: 4 };

/** Gives the stored section with the default limit of four workers when `maxWorkers` is absent. */
function withLimit(section: Record<string, unknown>): FactorySettings {
  return { ...DEFAULT_SETTINGS, ...section } as FactorySettings;
}

function validSettings(settings: FactorySettings): boolean {
  return (
    Number.isSafeInteger(settings.maxWorkers) &&
    settings.maxWorkers >= 1 &&
    (settings.workerModel === undefined || validModel(settings.workerModel)) &&
    validOverrides(settings) &&
    validFallbacks(settings.fallbackWorkerModels) &&
    (settings.git === undefined || validGit(settings.git)) &&
    (settings.checks === undefined || validChecks(settings.checks)) &&
    validDependencies(settings.dependencies) &&
    validPlacement(settings.placement) &&
    validStageClasses(settings.stageClasses)
  );
}

/** Tells if a value is a valid `factory` section. It does not throw, so `rowbly doctor` can use it. */
export function validFactorySettings(value: unknown): boolean {
  return isRecord(value) && validSettings(withLimit(value));
}

function validate(value: unknown): FactorySettings {
  assertChecks(isRecord(value) ? value.checks : undefined);

  if (!validFactorySettings(value)) {
    throw new ValidationError("Invalid factory settings", {
      hint: `Use booleans for git.push and git.pull, ${MIN_SYNC_SECONDS} to ${MAX_SYNC_SECONDS} for git.syncIntervalSeconds, and work or hold for stageClasses`,
    });
  }

  return withLimit(value as Record<string, unknown>);
}

/** Fills the absent Git sync keys and the absent placement policy with their defaults. The other `git` keys stay. */
function withDefaults(settings: FactorySettings): FactorySettings {
  const checks = checkLimits(settings.checks);
  const placement = settings.placement ?? DEFAULT_PLACEMENT;

  return { ...settings, git: { ...settings.git, ...gitSync(settings.git) }, ...(checks ? { checks } : {}), placement };
}

/** Gives the Git sync settings. Settings without a `git` section use the defaults. */
export function gitSettings(settings: FactorySettings): GitSync {
  return gitSync(settings.git);
}

/** Gives the `factory` section of the config as it is on disk. Without the section, the limit is four workers. */
function storedSettings(config: ProjectConfig): FactorySettings {
  return config.factory === undefined ? { ...DEFAULT_SETTINGS } : validate(config.factory);
}

/**
 * Stops a factory start and a settings write while an old `factory.json` exists, because Rowbly does not read it. A
 * write before the move makes a `factory` section that `rowbly doctor` cannot merge. It does not parse the file:
 * `rowbly doctor` checks it.
 */
export async function assertNoLegacyFactorySettings(paths: ProjectPaths): Promise<void> {
  if (await pathExists(paths.legacyFactorySettingsFile)) {
    throw new ConflictError("Rowbly does not read .rowbly/factory.json", {
      hint: "Run rowbly doctor --fix to move factory.json into rowbly.config.json, then do the operation again.",
    });
  }
}

/**
 * Reads the factory settings of the Project. Without a `factory` section in the config, the limit is four workers.
 * The absent Git sync keys have their defaults: push and pull are off, and the interval is 300 seconds.
 */
export async function getFactorySettings(ctx: ServiceContext = {}): Promise<FactorySettings> {
  const paths = await findProject(ctx);

  return withDefaults(storedSettings(await readConfig(paths)));
}

/**
 * Validates the settings that `change` makes from the settings on disk, and writes them to the `factory`
 * section of the config. The other config keys stay. The absent Git sync keys are not written, but `maxWorkers`
 * is always written. While an old `factory.json` exists, it gives a `ConflictError` and changes nothing.
 */
export async function writeSettings(
  change: (current: FactorySettings) => FactorySettings,
  ctx: ServiceContext,
): Promise<FactorySettings> {
  refuseRemoteWrite(ctx, "change the factory settings");

  const paths = await findProject(ctx);

  await assertNoLegacyFactorySettings(paths);

  const config = await readConfig(paths);
  const settings = validate(change(storedSettings(config)));

  await writeConfig(paths, { ...config, factory: { ...settings } });

  return withDefaults(settings);
}

/** Merges the input into the factory settings and writes them to the config. The `git` keys merge one level deep. */
export async function updateFactorySettings(
  input: FactorySettingsInput,
  ctx: ServiceContext = {},
): Promise<FactorySettings> {
  return writeSettings(
    (current) => ({ ...current, ...input, ...(input.git ? { git: { ...current.git, ...input.git } } : {}) }),
    ctx,
  );
}
