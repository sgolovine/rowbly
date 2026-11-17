import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ConflictError, ValidationError } from "../errors/errors.js";
import { createStory, getStory } from "../story/story.js";
import { useTempDir, useTestProject } from "../test-project/test-project.js";
import { projectPaths } from "../workspace/workspace.js";
import { defaultProjectName, getProject, initProject, updateProject } from "./project.js";

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
    expect(await readdir(paths.promptsDir)).toEqual(["SYSTEM.md", "WORKER.md"]);
    expect(await readFile(join(paths.promptsDir, "SYSTEM.md"), "utf8")).toBe("");
  });

  it("defaults the name to the folder name", async () => {
    const cwd = join(dir.path, "widgets");
    const project = await initProject({}, { cwd });
    expect(project.projectName).toBe("widgets");
    expect(project.projectKey).toBe("WID");
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
    const instructions = join(projectPaths(dir.path).promptsDir, "SYSTEM.md");
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

  it("updates the name", async () => {
    expect((await updateProject({ name: "New" }, project.ctx)).projectName).toBe("New");
    expect((await getProject(project.ctx)).projectName).toBe("New");
  });

  it("renames every story file to the new key", async () => {
    await createStory({ title: "One" }, project.ctx);
    await createStory({ title: "Two" }, project.ctx);
    await createStory({ title: "Three", stage: "DONE" }, project.ctx);
    await project.write("stories/ROW-04.md", "---\ntitle: Four\nstage: BACKLOG\n---\n");
    const updated = await updateProject({ key: "web" }, project.ctx);
    expect(updated.projectKey).toBe("WEB");
    expect(await readdir(project.paths.storiesDir)).toEqual(["BACKLOG", "DONE", "WEB-04.md"]);
    expect(await readdir(join(project.paths.storiesDir, "BACKLOG"))).toEqual(["WEB-01.md", "WEB-02.md"]);
    expect(await readdir(join(project.paths.storiesDir, "DONE"))).toEqual(["WEB-03.md"]);
  });

  it("changes the IDs in each dependsOn list to the new key", async () => {
    const at = (iso: string) => ({ ...project.ctx, now: () => new Date(iso) });
    await createStory({ title: "One" }, at("2025-01-01T00:00:00.000Z"));
    const two = await createStory({ title: "Two", dependsOn: ["ROW-01"] }, at("2025-01-01T00:00:00.000Z"));
    await updateProject({ key: "web" }, at("2025-02-02T00:00:00.000Z"));
    expect(two.uid).toBeDefined();
    expect(await project.read("stories/BACKLOG/WEB-02.md")).toBe(
      `---\ntitle: Two\nstage: BACKLOG\nuid: ${two.uid}\ndependsOn:\n  - WEB-01\ncreatedAt: 2025-01-01T00:00:00.000Z\nupdatedAt: 2025-02-02T00:00:00.000Z\n---\n\n`,
    );
    expect((await getStory({ id: "WEB-01" }, project.ctx)).updatedAt).toBe("2025-01-01T00:00:00.000Z");
    expect((await getStory({ id: "WEB-02" }, project.ctx)).dependsOn).toEqual(["WEB-01"]);
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

  it("updates the display options and keeps the other config keys", async () => {
    const config = JSON.parse(await project.read("rowbly.config.json"));
    const skills = [{ name: "develop", harnesses: ["codex"] }];
    const factory = { maxWorkers: 3 };
    await project.write(
      "rowbly.config.json",
      JSON.stringify({ ...config, features: { specs: true }, skills, factory }),
    );

    const updated = await updateProject({ display: { compactThreads: false } }, project.ctx);
    expect(updated.display).toEqual({ compactThreads: false });

    const raw = JSON.parse(await project.read("rowbly.config.json"));
    expect(raw).toMatchObject({ features: { specs: true }, skills, factory, display: { compactThreads: false } });

    await updateProject({ name: "Renamed" }, project.ctx);
    expect((await getProject(project.ctx)).display).toEqual({ compactThreads: false });
    await updateProject({ display: { compactThreads: true } }, project.ctx);
    expect((await getProject(project.ctx)).display).toEqual({ compactThreads: true });
  });

  it("saves the Story sidebar option and keeps the other display options", async () => {
    await updateProject({ display: { compactThreads: false, timeZone: "Europe/Berlin" } }, project.ctx);
    const updated = await updateProject({ display: { storySidebar: "expanded" } }, project.ctx);
    const expected = { compactThreads: false, timeZone: "Europe/Berlin", storySidebar: "expanded" };
    expect(updated.display).toEqual(expected);
    expect(JSON.parse(await project.read("rowbly.config.json")).display).toEqual(expected);
    await updateProject({ display: { storySidebar: "remember" } }, project.ctx);
    expect((await getProject(project.ctx)).display).toEqual({ ...expected, storySidebar: "remember" });
    const before = await project.read("rowbly.config.json");
    await expect(updateProject({ display: { storySidebar: "wide" as "regular" } }, project.ctx)).rejects.toMatchObject({
      code: "VALIDATION",
    });
    expect(await project.read("rowbly.config.json")).toBe(before);
  });

  it("saves and removes the time zone, and rejects an unknown zone", async () => {
    const updated = await updateProject({ display: { timeZone: "Europe/Berlin" } }, project.ctx);
    expect(updated.display).toEqual({ timeZone: "Europe/Berlin" });
    expect(JSON.parse(await project.read("rowbly.config.json")).display).toEqual({ timeZone: "Europe/Berlin" });
    await updateProject({ display: { compactThreads: false } }, project.ctx);
    expect((await getProject(project.ctx)).display).toEqual({ timeZone: "Europe/Berlin", compactThreads: false });
    await updateProject({ display: { timeZone: "" } }, project.ctx);
    expect(JSON.parse(await project.read("rowbly.config.json")).display).toEqual({ compactThreads: false });
    const before = await project.read("rowbly.config.json");
    await expect(updateProject({ display: { timeZone: "Mars/Olympus" } }, project.ctx)).rejects.toMatchObject({
      code: "VALIDATION",
    });
    expect(await project.read("rowbly.config.json")).toBe(before);
  });
});
