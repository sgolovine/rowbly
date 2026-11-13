import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ConflictError, ValidationError } from "../errors/errors.js";
import { createStory } from "../story/story.js";
import { useTempDir, useTestProject } from "../test-project/test-project.js";
import { projectPaths } from "../workspace/workspace.js";
import { defaultProjectName, getInstructions, getProject, initProject, updateProject } from "./project.js";

describe("initProject", () => {
  const dir = useTempDir();

  it("names the default after the directory of the context", () => {
    expect(defaultProjectName({ cwd: join(dir.path, "my-app") })).toBe("my-app");
  });

  it("creates the config, the default stages and the stories folder", async () => {
    const project = await initProject({ name: "My Cool Project" }, { cwd: dir.path });
    expect(project).toEqual({
      root: dir.path,
      projectName: "My Cool Project",
      projectKey: "MYC",
      customFields: [],
      stages: [
        { key: "BACKLOG", label: "Backlog", enabled: true },
        { key: "DONE", label: "Done", enabled: true },
      ],
    });
    const paths = projectPaths(dir.path);
    expect(await readdir(paths.stagesDir)).toEqual(["BACKLOG.md", "DONE.md"]);
    expect(await readdir(paths.storiesDir)).toEqual([]);
    expect(await readFile(paths.instructionsFile, "utf8")).toBe("# ROWBLY INSTRUCTIONS\n");
    expect((await getInstructions({ cwd: dir.path })).instructions).toBe("# ROWBLY INSTRUCTIONS");
  });

  it("defaults the name to the folder name", async () => {
    const cwd = join(dir.path, "widgets");
    const project = await initProject({}, { cwd });
    expect(project.projectName).toBe("widgets");
    expect(project.projectKey).toBe("WID");
    expect(await readFile(projectPaths(cwd).instructionsFile, "utf8")).toBe("# ROWBLY INSTRUCTIONS\n");
  });

  it("uppercases and trims the key and the name", async () => {
    const project = await initProject({ name: " Rowbly ", key: " abc " }, { cwd: dir.path });
    expect(project.projectName).toBe("Rowbly");
    expect(project.projectKey).toBe("ABC");
  });

  it("rejects an empty name and an invalid key", async () => {
    const error = await initProject({ name: " ", key: "1X" }, { cwd: dir.path }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).details.issues).toMatchObject([{ path: ["name"] }, { path: ["key"] }]);
  });

  it("refuses to run twice", async () => {
    await initProject({ name: "A" }, { cwd: dir.path });
    const instructions = projectPaths(dir.path).instructionsFile;
    await writeFile(instructions, "Keep my instructions.\n");
    await expect(initProject({ name: "A" }, { cwd: dir.path })).rejects.toBeInstanceOf(ConflictError);
    expect(await readFile(instructions, "utf8")).toBe("Keep my instructions.\n");
  });
});

describe("getProject and updateProject", () => {
  const project = useTestProject();

  it("getProject reads the config", async () => {
    expect(await getProject(project.ctx)).toMatchObject({ projectName: "Rowbly", projectKey: "ROW" });
  });

  it("getInstructions is empty when the project has no ROWBLY.md", async () => {
    await rm(project.paths.instructionsFile);
    expect(await getInstructions(project.ctx)).toEqual({ path: project.paths.instructionsFile, instructions: "" });
  });

  it("getInstructions reads ROWBLY.md from a directory below the project", async () => {
    await project.write("ROWBLY.md", "\nRun the tests first.\n\n");
    const below = { cwd: join(project.paths.root, "src") };
    await mkdir(below.cwd);
    expect((await getInstructions(below)).instructions).toBe("Run the tests first.");
  });

  it("updates the name", async () => {
    expect((await updateProject({ name: "New" }, project.ctx)).projectName).toBe("New");
    expect((await getProject(project.ctx)).projectName).toBe("New");
  });

  it("renames every story file to the new key", async () => {
    await createStory({ title: "One" }, project.ctx);
    await createStory({ title: "Two" }, project.ctx);
    const updated = await updateProject({ key: "web" }, project.ctx);
    expect(updated.projectKey).toBe("WEB");
    expect(await readdir(project.paths.storiesDir)).toEqual(["WEB-01.md", "WEB-02.md"]);
  });

  it("refuses a key that other story files already use", async () => {
    await createStory({ title: "One" }, project.ctx);
    await project.write("stories/WEB-01.md", "---\ntitle: Old\n---\n");
    await expect(updateProject({ key: "WEB" }, project.ctx)).rejects.toBeInstanceOf(ConflictError);
    expect((await getProject(project.ctx)).projectKey).toBe("ROW");
  });

  it("rejects an invalid key", async () => {
    await expect(updateProject({ key: "w-b" }, project.ctx)).rejects.toBeInstanceOf(ValidationError);
  });
});
