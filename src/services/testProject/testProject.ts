import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach } from "vitest";
import { type InitProjectInput, initProject } from "../project/project.js";
import { type ProjectPaths, projectPaths, type ServiceContext } from "../workspace/workspace.js";

export interface TestProject {
  ctx: ServiceContext;
  paths: ProjectPaths;
  /** Reads a file inside `.rowbly/`. */
  read(path: string): Promise<string>;
  /** Writes a file inside `.rowbly/`, to set up a hand-edited state. */
  write(path: string, content: string): Promise<void>;
}

/** Makes a temporary directory for each test and removes it afterwards. */
export function useTempDir(): { readonly path: string } {
  const dir = { path: "" };
  beforeEach(async () => {
    dir.path = await mkdtemp(join(tmpdir(), "rowbly-test-"));
  });
  afterEach(async () => {
    await rm(dir.path, { recursive: true, force: true });
  });
  return dir;
}

/** Runs `initProject` in a fresh temporary directory before each test. */
export function useTestProject(input: InitProjectInput = { name: "Rowbly", key: "ROW" }): TestProject {
  const dir = useTempDir();
  const project: TestProject = {
    ctx: {},
    paths: projectPaths(""),
    read: (path) => readFile(join(project.paths.dir, path), "utf8"),
    write: (path, content) => writeFile(join(project.paths.dir, path), content, "utf8"),
  };
  beforeEach(async () => {
    project.ctx = { cwd: dir.path };
    project.paths = projectPaths(dir.path);
    await initProject(input, project.ctx);
  });
  return project;
}
