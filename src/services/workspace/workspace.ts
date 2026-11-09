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
}

export interface ProjectPaths {
  /** The directory that contains `.rowbly/`. */
  root: string;
  dir: string;
  configFile: string;
  instructionsFile: string;
  storiesDir: string;
  stagesDir: string;
  specsDir: string;
}

export function projectPaths(root: string): ProjectPaths {
  const dir = join(root, ROWBLY_DIR);
  return {
    root,
    dir,
    configFile: join(dir, "rowbly.config.json"),
    instructionsFile: join(dir, "ROWBLY.md"),
    storiesDir: join(dir, "stories"),
    stagesDir: join(dir, "stages"),
    specsDir: join(dir, "specs"),
  };
}

/** Finds the nearest project at or above `ctx.cwd`, the way git finds its repository. */
export async function findProject(ctx: ServiceContext = {}): Promise<ProjectPaths> {
  let dir = resolve(ctx.cwd ?? process.cwd());
  for (;;) {
    const paths = projectPaths(dir);
    if (await pathExists(paths.configFile)) return paths;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new NotFoundError("No Rowbly project found in this directory or any parent", {
    hint: "Run `rowbly init` to create one here.",
  });
}
