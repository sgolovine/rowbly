import { dirname, join, resolve } from "node:path";
import { NotFoundError } from "../errors/errors.js";
import { pathExists } from "../files/files.js";

/** The folder, inside the directory Rowbly runs in, that holds a project. */
const ROWBLY_DIR = ".rowbly";

/** Where a service looks for the project. Every service takes one, so tests can point it anywhere. */
export interface ServiceContext {
  /** The directory to start from. Defaults to `process.cwd()`. */
  cwd?: string;
  /** The home directory of the user. Defaults to `os.homedir()`. */
  home?: string;
  /** The clock. Defaults to the system time. */
  now?: () => Date;
  /** The folder of the bundled skills. Defaults to `skills/` in the Rowbly package. */
  skillsDir?: string;
}

export interface ProjectPaths {
  /** The directory that contains `.rowbly/`. */
  root: string;
  dir: string;
  configFile: string;
  /** The user prompts: `SYSTEM.md`, `SUPERVISOR.md` and `WORKER.md`. */
  promptsDir: string;
  /** The old place of the Project prompt. `rowbly doctor --fix` moves it to `prompts/SYSTEM.md`. */
  legacyInstructionsFile: string;
  storiesDir: string;
  stagesDir: string;
  specsDir: string;
  ignoreFile: string;
  /** The old place of the factory settings. `rowbly doctor --fix` moves them to the `factory` key of the config. */
  legacyFactorySettingsFile: string;
  stateFile: string;
  runtimeDir: string;
}

/** Gives the paths of the project files for a project in `root`. */
export function projectPaths(root: string): ProjectPaths {
  const dir = join(root, ROWBLY_DIR);

  return {
    root,
    dir,
    configFile: join(dir, "rowbly.config.json"),
    promptsDir: join(dir, "prompts"),
    legacyInstructionsFile: join(dir, "ROWBLY.md"),
    storiesDir: join(dir, "stories"),
    stagesDir: join(dir, "stages"),
    specsDir: join(dir, "specs"),
    ignoreFile: join(dir, ".gitignore"),
    legacyFactorySettingsFile: join(dir, "factory.json"),
    stateFile: join(dir, "state.json"),
    runtimeDir: join(dir, "runtime"),
  };
}

/** Tells if a project is in `ctx.cwd` itself. It does not look in the parent directories, as `findProject` does. */
export async function hasProject(ctx: ServiceContext = {}): Promise<boolean> {
  return pathExists(projectPaths(resolve(ctx.cwd ?? process.cwd())).configFile);
}

/** Gives the paths of the project in `dir`, or in the nearest parent directory that has one. */
async function nearestProject(dir: string): Promise<ProjectPaths | undefined> {
  const paths = projectPaths(dir);
  const parent = dirname(dir);

  if (await pathExists(paths.configFile)) {
    return paths;
  }

  return parent === dir ? undefined : nearestProject(parent);
}

/** Finds the nearest project at or above `ctx.cwd`, the way git finds its repository. */
export async function findProject(ctx: ServiceContext = {}): Promise<ProjectPaths> {
  const paths = await nearestProject(resolve(ctx.cwd ?? process.cwd()));

  if (!paths) {
    throw new NotFoundError("No Rowbly project found in this directory or any parent", {
      hint: "Run `rowbly init` to create one here.",
    });
  }

  return paths;
}

/** Gives the paths of the private runtime files of the native factory. */
export function runtimePaths(paths: ProjectPaths) {
  const dir = paths.runtimeDir;

  return {
    dir,
    lockFile: join(dir, "factory.lock"),
    guardFile: join(dir, "lifecycle.guard"),
    statusFile: join(dir, "status.json"),
    controlDir: join(dir, "control"),
    receiptsDir: join(dir, "receipts"),
    threadsDir: join(dir, "threads"),
    sessionsDir: join(dir, "sessions"),
    binDir: join(dir, "bin"),
    logsDir: join(dir, "logs"),
    checksDir: join(dir, "checks"),
  };
}
