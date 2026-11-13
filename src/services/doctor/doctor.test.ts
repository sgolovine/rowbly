import { lstat, mkdir, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { readConfig } from "../config/config.js";
import { addCustomField } from "../custom-field/custom-field.js";
import { pathExists } from "../files/files.js";
import { installSkill } from "../skill/skill.js";
import { createStory } from "../story/story.js";
import { useTempDir, useTestProject } from "../test-project/test-project.js";
import type { ServiceContext } from "../workspace/workspace.js";
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

  describe("old agent locks", () => {
    const BODY = "\nThe description.\n";
    const write = (lock: string) =>
      project.write("stories/ROW-01.md", `---\ntitle: T\nstage: BACKLOG\nposition: 1\n${lock}\n---\n${BODY}`);

    it.each([
      ["a well-formed lock", "agentLock:\n  agent: claude\n  stage: BACKLOG\n  lockedAt: 2026-11-09T10:00:00.000Z"],
      ["a malformed lock", "agentLock: claude"],
    ])("warns about %s, and --fix removes only the key", async (_name, lock) => {
      await write(lock);
      const found = await doctor({}, project.ctx);
      expect(found.ok).toBe(true);
      expect(found.issues).toEqual([
        {
          severity: "warning",
          message: "agentLock is no longer used",
          file: join(".rowbly", "stories", "ROW-01.md"),
          fix: "Remove it",
          fixed: false,
        },
      ]);
      expect((await doctor({ fix: true }, project.ctx)).issues).toMatchObject([{ fixed: true }]);
      expect(await project.read("stories/ROW-01.md")).toBe(`---\ntitle: T\nstage: BACKLOG\nposition: 1\n---\n${BODY}`);
      expect((await doctor({}, project.ctx)).issues).toEqual([]);
    });
  });
});

describe("doctor skill checks", () => {
  const project = useTestProject();
  const fixture = useTempDir();
  let ctx: ServiceContext;
  const skillDir = () => join(project.paths.root, ".claude", "skills", "alpha");
  const file = join(".claude", "skills", "alpha");
  const setConfigSkills = async (skills: unknown) => {
    const config = JSON.parse(await project.read("rowbly.config.json"));
    await project.write("rowbly.config.json", JSON.stringify({ ...config, skills }));
  };

  beforeEach(async () => {
    await mkdir(join(fixture.path, "alpha"));
    await writeFile(join(fixture.path, "alpha", "SKILL.md"), "alpha");
    ctx = { ...project.ctx, skillsDir: fixture.path };
    await installSkill({ name: "alpha", harnesses: ["claude-code"] }, ctx);
  });

  it("finds no issues when each tracked skill is installed", async () => {
    expect(await doctor({}, ctx)).toMatchObject({ issues: [], ok: true });
  });

  it("reports a missing skill as an error, and restores it with --fix", async () => {
    await rm(skillDir(), { recursive: true });
    expect(await doctor({}, ctx)).toMatchObject({
      ok: false,
      issues: [
        {
          severity: "error",
          message: "Skill alpha for claude-code is missing",
          file,
          fix: "Install it again",
          fixed: false,
        },
      ],
    });

    expect(await doctor({ fix: true }, ctx)).toMatchObject({ ok: true, issues: [{ fixed: true }] });
    expect(await readFile(join(skillDir(), "SKILL.md"), "utf8")).toBe("alpha");
    expect(await doctor({}, ctx)).toMatchObject({ issues: [], ok: true });
  });

  it("restores a skill when its parent folders are missing", async () => {
    await rm(join(project.paths.root, ".claude"), { recursive: true });
    expect((await doctor({ fix: true }, ctx)).ok).toBe(true);
    expect(await readFile(join(skillDir(), "SKILL.md"), "utf8")).toBe("alpha");
  });

  it("does not overwrite a folder that lacks SKILL.md", async () => {
    await rm(join(skillDir(), "SKILL.md"));
    await writeFile(join(skillDir(), "mine.md"), "mine");
    const report = await doctor({ fix: true }, ctx);
    expect(report.ok).toBe(false);
    expect(report.issues).toEqual([
      {
        severity: "error",
        message:
          "Skill alpha for claude-code has no SKILL.md. Repair the folder by hand, or delete it with `rowbly skill remove alpha --harness claude-code`",
        file,
        fixed: false,
      },
    ]);
    expect(await readdir(skillDir())).toEqual(["mine.md"]);
  });

  it("does not replace a broken symlink", async () => {
    await rm(skillDir(), { recursive: true });
    await symlink("missing", skillDir());
    const report = await doctor({ fix: true }, ctx);
    expect(report.issues[0]).toMatchObject({ fixed: false });
    expect(report.ok).toBe(false);
  });

  describe("when the skills folder cannot be created", () => {
    const brokenFolder = async () => {
      await rm(join(project.paths.root, ".claude", "skills"), { recursive: true });
      await symlink("missing", join(project.paths.root, ".claude", "skills"));
    };
    const message = `Skill alpha for claude-code is missing, and Rowbly cannot create ${join(".claude", "skills")}. Repair that path, or run \`rowbly skill remove alpha --harness claude-code\``;

    it("offers no fix for a broken symlink", async () => {
      await brokenFolder();
      const report = await doctor({}, ctx);
      expect(report.ok).toBe(false);
      expect(report.issues).toEqual([{ severity: "error", message, file, fixed: false }]);
    });

    it("offers no fix for a file in place of the folder", async () => {
      await rm(join(project.paths.root, ".claude", "skills"), { recursive: true });
      await writeFile(join(project.paths.root, ".claude", "skills"), "");
      const report = await doctor({}, ctx);
      expect(report.issues).toEqual([{ severity: "error", message, file, fixed: false }]);
    });

    it("does not stop --fix, and reports the other fixes", async () => {
      await installSkill({ name: "alpha", harnesses: ["cursor"] }, ctx);
      await rm(join(project.paths.root, ".cursor", "skills", "alpha"), { recursive: true });
      await rm(join(project.paths.stagesDir, "DONE.md"));
      await brokenFolder();

      const report = await doctor({ fix: true }, ctx);
      expect(report.ok).toBe(false);
      expect(report.issues.map((issue) => [issue.file, issue.fixed])).toEqual([
        [join(".rowbly", "stages", "DONE.md"), true],
        [file, false],
        [join(".cursor", "skills", "alpha"), true],
      ]);
      expect(await pathExists(join(project.paths.root, ".cursor", "skills", "alpha", "SKILL.md"))).toBe(true);
      expect((await lstat(join(project.paths.root, ".claude", "skills"))).isSymbolicLink()).toBe(true);
    });
  });

  it("reports a missing skill with no fix when Rowbly no longer bundles it", async () => {
    await rm(skillDir(), { recursive: true });
    await rm(join(fixture.path, "alpha"), { recursive: true });
    const report = await doctor({ fix: true }, ctx);
    expect(report.ok).toBe(false);
    expect(report.issues[0]?.message).toContain("no longer bundles it");
    expect(report.issues[0]?.message).toContain("rowbly skill remove alpha --harness claude-code");
    expect(report.issues[0]?.fixed).toBe(false);
  });

  it("restores one copy when two tracked harnesses share a folder", async () => {
    await mkdir(join(project.paths.root, ".agents"));
    await symlink("../.claude/skills", join(project.paths.root, ".agents", "skills"));
    await installSkill({ name: "alpha", harnesses: ["codex"] }, ctx);
    await rm(skillDir(), { recursive: true });
    expect((await doctor({ fix: true }, ctx)).issues).toHaveLength(1);
    expect(await doctor({}, ctx)).toMatchObject({ issues: [], ok: true });
  });

  it("reports a malformed skill entry through the config check and stops", async () => {
    await setConfigSkills([{ name: "../x", harnesses: ["vim"] }]);
    const report = await doctor({}, ctx);
    expect(report.ok).toBe(false);
    expect(report.issues.map((issue) => issue.file)).toEqual([
      join(".rowbly", "rowbly.config.json"),
      join(".rowbly", "rowbly.config.json"),
    ]);
    expect(report.issues[1]?.message).toBe('skills.0.harnesses.0: Unknown harness "vim"');
  });
});
