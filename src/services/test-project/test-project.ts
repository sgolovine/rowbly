import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach } from "vitest";
import { type InitProjectInput, initProject } from "../project/project.js";
import { Store } from "../store/store.js";
import { type ProjectPaths, projectPaths, type ServiceContext } from "../workspace/workspace.js";

export interface TestProject {
  ctx: ServiceContext;
  paths: ProjectPaths;
  /** Reads a file inside `.rowbly/`. */
  read(path: string): Promise<string>;
  /** Writes a file inside `.rowbly/`, to set up a hand-edited state. */
  write(path: string, content: string): Promise<void>;
}

interface TempDir {
  readonly path: string;
}

interface ProjectState {
  readonly ctx: ServiceContext;
  readonly paths: ProjectPaths;
}

async function makeTempDir(dir: Store<TempDir>): Promise<void> {
  const path = await mkdtemp(join(tmpdir(), "rowbly-test-"));

  dir.update(() => ({ path }));
}

async function makeTestProject(
  project: Store<ProjectState>,
  dir: { readonly path: string },
  input: InitProjectInput,
): Promise<void> {
  const { ctx } = project.update(() => ({ ctx: { cwd: dir.path }, paths: projectPaths(dir.path) }));

  await initProject(input, ctx);
}

/** Makes a temporary directory for each test and removes it afterwards. */
export function useTempDir(): { readonly path: string } {
  const dir = new Store<TempDir>({ path: "" });

  beforeEach(() => makeTempDir(dir));
  afterEach(() => rm(dir.current.path, { recursive: true, force: true }));

  // A test reads `path` after `beforeEach` runs, so the getter reads the store at that time.
  return {
    get path() {
      return dir.current.path;
    },
  };
}

/** Runs `initProject` in a fresh temporary directory before each test. */
export function useTestProject(input: InitProjectInput = { name: "Rowbly", key: "ROW" }): TestProject {
  const dir = useTempDir();
  const project = new Store<ProjectState>({ ctx: {}, paths: projectPaths("") });

  beforeEach(() => makeTestProject(project, dir, input));

  // The getters read the store when a test runs, after `beforeEach` made the project.
  return {
    get ctx() {
      return project.current.ctx;
    },
    get paths() {
      return project.current.paths;
    },
    read: (path) => readFile(join(project.current.paths.dir, path), "utf8"),
    write: (path, content) => writeFile(join(project.current.paths.dir, path), content, "utf8"),
  };
}
