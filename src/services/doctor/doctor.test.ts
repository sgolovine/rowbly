import { mkdir, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readConfig } from "../config/config.js";
import { addCustomField } from "../customField/customField.js";
import { createStory } from "../story/story.js";
import { useTestProject } from "../testProject/testProject.js";
import { doctor } from "./doctor.js";

describe("doctor", () => {
  const project = useTestProject();
  const messages = async (fix = false) => (await doctor({ fix }, project.ctx)).issues.map((issue) => issue.message);

  it("finds no issues in a new project", async () => {
    await createStory({ title: "T" }, project.ctx);
    expect(await doctor({}, project.ctx)).toEqual({ root: project.paths.root, issues: [], ok: true });
  });

  it("reports an invalid config and stops", async () => {
    await project.write("rowbly.config.json", JSON.stringify({ projectName: "", projectKey: "ROW", customFields: [] }));
    const report = await doctor({}, project.ctx);
    expect(report.ok).toBe(false);
    expect(report.issues.map((issue) => issue.message)).toEqual([
      "projectName: projectName is required",
      "stages: stages must be an array",
    ]);
    expect(report.issues[0]?.file).toBe(join(".rowbly", "rowbly.config.json"));
  });

  it("creates missing folders and stage files with --fix", async () => {
    await rm(project.paths.storiesDir, { recursive: true });
    await rm(join(project.paths.stagesDir, "DONE.md"));
    const report = await doctor({}, project.ctx);
    expect(report.ok).toBe(false);
    expect(report.issues.map((issue) => [issue.message, issue.fixed])).toEqual([
      ["Folder is missing", false],
      ["Stage DONE has no file", false],
    ]);

    expect((await doctor({ fix: true }, project.ctx)).ok).toBe(true);
    expect(await readdir(project.paths.storiesDir)).toEqual([]);
    expect(await readdir(project.paths.stagesDir)).toContain("DONE.md");
    expect(await doctor({}, project.ctx)).toMatchObject({ issues: [], ok: true });
  });

  it("adds a stage file that is not in the config with --fix", async () => {
    await project.write("stages/IN_REVIEW.md", "Review it");
    await project.write("stages/bad-key.md", "");
    expect(await messages()).toEqual([
      "Stage IN_REVIEW is not in the config",
      '"bad-key" is not a valid stage key (UPPER_SNAKE_CASE)',
    ]);
    await doctor({ fix: true }, project.ctx);
    expect((await readConfig(project.paths)).stages.at(-1)).toEqual({
      key: "IN_REVIEW",
      label: "In Review",
      enabled: true,
    });
  });

  it("reports bad story file names, foreign keys and duplicate numbers", async () => {
    await project.write("stories/notes.md", "");
    await project.write("stories/ROW-1.md", "---\ntitle: A\nstage: BACKLOG\n---\n");
    await project.write("stories/WEB-01.md", "---\ntitle: B\nstage: BACKLOG\n---\n");
    expect(await messages()).toEqual([
      "Story key WEB does not match the project key ROW",
      "Story number 1 is also used by ROW-1.md",
      "File name should be ROW-<number>.md",
    ]);
  });

  it("reports invalid frontmatter", async () => {
    await project.write("stories/ROW-01.md", "---\ntitle: [oops\n---\n");
    const [message] = await messages();
    expect(message).toMatch(/^Invalid frontmatter: /);
  });

  it("checks and fixes the title, stage and custom fields of a story", async () => {
    await addCustomField({ label: "Points", type: "number" }, project.ctx);
    await addCustomField({ label: "Owner", type: "string" }, project.ctx);
    await addCustomField({ label: "Done", type: "boolean" }, project.ctx);
    await project.write("stories/ROW-01.md", "---\ntitle: A\nstage: done\npoints: '3'\ndone: maybe\nextra: 1\n---\n");
    await project.write("stories/ROW-02.md", "---\nstage: NOPE\npoints: null\nowner: null\ndone: null\n---\n");
    await project.write("stories/ROW-03.md", "---\ntitle: C\npoints: null\nowner: null\ndone: null\n---\n");

    const before = await doctor({}, project.ctx);
    expect(before.issues.map(({ file, message, fixed }) => [file.split("/").at(-1), message, fixed])).toEqual([
      ["ROW-01.md", 'Stage "done" should be DONE', false],
      ["ROW-01.md", "Points must be a number", false],
      ["ROW-01.md", 'Custom field "owner" is missing', false],
      ["ROW-01.md", "Done must be true or false", false],
      ["ROW-01.md", '"extra" is not a custom field of this project', false],
      ["ROW-02.md", "Title is missing", false],
      ["ROW-02.md", 'Unknown stage "NOPE". Stages: BACKLOG, DONE', false],
      ["ROW-03.md", "Stage is missing", false],
    ]);
    expect(before.issues[1]?.fix).toBe("Change it to 3");
    expect(before.issues[3]?.fix).toBeUndefined();

    const after = await doctor({ fix: true }, project.ctx);
    expect(after.issues.filter((issue) => !issue.fixed).map((issue) => issue.message)).toEqual([
      "Done must be true or false",
      "Title is missing",
      'Unknown stage "NOPE". Stages: BACKLOG, DONE',
    ]);
    expect(after.ok).toBe(false);
    expect(await project.read("stories/ROW-01.md")).toBe(
      "---\ntitle: A\nstage: DONE\npoints: 3\nowner: null\ndone: maybe\n---\n\n",
    );
    expect(await project.read("stories/ROW-03.md")).toContain("stage: BACKLOG");
  });

  it("accepts the position of a story", async () => {
    await project.write("stories/ROW-01.md", "---\ntitle: A\nstage: BACKLOG\nposition: 0\n---\n");
    expect(await messages()).toEqual([]);
  });

  it("warns about a story in a disabled stage", async () => {
    await createStory({ title: "T", stage: "DONE" }, project.ctx);
    const config = await readConfig(project.paths);
    await project.write(
      "rowbly.config.json",
      JSON.stringify({ ...config, stages: config.stages.map((s) => ({ ...s, enabled: s.key !== "DONE" })) }),
    );
    const report = await doctor({}, project.ctx);
    expect(report.issues).toMatchObject([{ severity: "warning", message: "Stage DONE is disabled" }]);
    expect(report.ok).toBe(true);
  });

  it("works from a subfolder", async () => {
    const sub = join(project.paths.root, "src");
    await mkdir(sub);
    expect((await doctor({}, { cwd: sub })).root).toBe(project.paths.root);
  });

  describe("specs", () => {
    const spec = (frontmatter: string, name = "design.md") =>
      project.write(`specs/${name}`, `---\n${frontmatter}\n---\n\nBody\n`);

    it("finds no issues in a spec that links to a Story", async () => {
      await createStory({ title: "T" }, project.ctx);
      await mkdir(project.paths.specsDir);
      await spec("title: Design\nstories: [ROW-01]");
      expect(await doctor({}, project.ctx)).toMatchObject({ issues: [], ok: true });
    });

    it("warns about an orphan spec and a link to a Story that does not exist", async () => {
      await createStory({ title: "T" }, project.ctx);
      await mkdir(project.paths.specsDir);
      await spec("title: Design\nstories: []");
      await spec("title: Gone\nstories: [ROW-01, ROW-07]", "gone.md");
      const report = await doctor({}, project.ctx);
      expect(report.ok).toBe(true);
      expect(report.issues.map((i) => [i.severity, i.file, i.message])).toEqual([
        ["warning", join(".rowbly", "specs", "design.md"), "Orphan spec: it is not linked to a Story"],
        ["warning", join(".rowbly", "specs", "gone.md"), "Links to ROW-07, which does not exist"],
      ]);
      await doctor({ fix: true }, project.ctx);
      expect(await project.read("specs/gone.md")).toContain("stories:\n  - ROW-01\n");
      expect(await messages()).toEqual(["Orphan spec: it is not linked to a Story"]);
    });

    it("fixes a missing title, a Story ID in another form, a repeat and an unknown key", async () => {
      await createStory({ title: "T" }, project.ctx);
      await mkdir(project.paths.specsDir);
      await spec("stories: row-1\nowner: sam", "login-page.md");
      await project.write("specs/Bad Name.md", "");
      expect(await messages()).toEqual([
        '"Bad Name" is not a valid spec slug (lowercase letters and digits, with - between words)',
        "Title is missing",
        "stories must be a list of Story IDs",
        'Story ID "row-1" should be ROW-01',
        '"owner" is not a spec key (title, stories)',
      ]);
      await doctor({ fix: true }, project.ctx);
      expect(await project.read("specs/login-page.md")).toBe(
        "---\ntitle: Login page\nstories:\n  - ROW-01\n---\n\nBody\n",
      );
    });
  });

  describe("agent locks", () => {
    const LOCK = "agent: claude\n  stage: BACKLOG\n  lockedAt: 2026-11-09T10:00:00.000Z";
    const write = (stage: string, lock: string) =>
      project.write("stories/ROW-01.md", `---\ntitle: T\nstage: ${stage}\n${lock}\n---\n`);

    it("accepts a current lock", async () => {
      await write("BACKLOG", `agentLock:\n  ${LOCK}`);
      expect((await doctor({}, project.ctx)).issues).toEqual([]);
    });

    it("reports a malformed lock and leaves it alone with --fix", async () => {
      await write("BACKLOG", "agentLock: claude");
      const report = await doctor({ fix: true }, project.ctx);
      expect(report.ok).toBe(false);
      expect(report.issues).toMatchObject([{ severity: "error", fixed: false }]);
      expect(await project.read("stories/ROW-01.md")).toContain("agentLock: claude");
    });

    it("warns about a stale lock, and --fix removes it", async () => {
      await write("DONE", `agentLock:\n  ${LOCK}`);
      const found = await doctor({}, project.ctx);
      expect(found.ok).toBe(true);
      expect(found.issues).toMatchObject([
        { severity: "warning", fixed: false, message: expect.stringContaining("BACKLOG") },
      ]);
      expect((await doctor({ fix: true }, project.ctx)).issues).toMatchObject([{ fixed: true }]);
      expect(await project.read("stories/ROW-01.md")).not.toContain("agentLock");
    });
  });
});
