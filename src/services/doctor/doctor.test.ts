import { lstat, mkdir, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { readConfig } from "../config/config.js";
import { addCustomField } from "../custom-field/custom-field.js";
import { pathExists } from "../files/files.js";
import { installSkill } from "../skill/skill.js";
import { createStory } from "../story/story.js";
import { useTempDir, useTestProject } from "../test-project/test-project.js";
import { createThread } from "../thread/thread.js";
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
    await project.write(
      "stories/BACKLOG/ROW-1.md",
      "---\ntitle: A\nstage: BACKLOG\nuid: 7fc56270-e7a7-4fa8-8a59-35b72eacbe29\n---\n",
    );
    await project.write(
      "stories/BACKLOG/WEB-01.md",
      "---\ntitle: B\nstage: BACKLOG\nuid: 9d5ed678-fe57-4cca-8101-40957afab571\n---\n",
    );
    expect(await messages()).toEqual([
      "File name should be ROW-<number>.md",
      "Story key WEB does not match the project key ROW",
      `Story number 1 is also used by ${join(".rowbly", "stories", "BACKLOG", "ROW-1.md")}`,
    ]);
  });

  it("warns about a Story file outside the folder of its Stage, and --fix moves it", async () => {
    await project.write(
      "stories/ROW-01.md",
      "---\ntitle: A\nstage: BACKLOG\nuid: 7fc56270-e7a7-4fa8-8a59-35b72eacbe29\n---\n\nFlat.\n",
    );
    await project.write(
      "stories/DONE/ROW-02.md",
      "---\ntitle: B\nstage: BACKLOG\nuid: 9d5ed678-fe57-4cca-8101-40957afab571\n---\n\nWrong folder.\n",
    );
    const before = await doctor({}, project.ctx);
    expect(before.ok).toBe(true);
    expect(before.issues).toEqual([
      {
        severity: "warning",
        message: "Story file is not in the folder of its Stage BACKLOG",
        file: join(".rowbly", "stories", "ROW-01.md"),
        fix: `Move it to ${join(".rowbly", "stories", "BACKLOG", "ROW-01.md")}`,
        fixed: false,
      },
      {
        severity: "warning",
        message: "Story file is in the folder DONE, not in the folder of its Stage BACKLOG",
        file: join(".rowbly", "stories", "DONE", "ROW-02.md"),
        fix: `Move it to ${join(".rowbly", "stories", "BACKLOG", "ROW-02.md")}`,
        fixed: false,
      },
    ]);

    expect((await doctor({ fix: true }, project.ctx)).issues.map((issue) => issue.fixed)).toEqual([true, true]);
    expect(await project.read("stories/BACKLOG/ROW-01.md")).toBe(
      "---\ntitle: A\nstage: BACKLOG\nuid: 7fc56270-e7a7-4fa8-8a59-35b72eacbe29\n---\n\nFlat.\n",
    );
    expect(await project.read("stories/BACKLOG/ROW-02.md")).toBe(
      "---\ntitle: B\nstage: BACKLOG\nuid: 9d5ed678-fe57-4cca-8101-40957afab571\n---\n\nWrong folder.\n",
    );
    expect(await readdir(project.paths.storiesDir)).toEqual(["BACKLOG"]);
    expect(await doctor({}, project.ctx)).toMatchObject({ issues: [], ok: true });
  });

  it("reports a duplicate Story ID with a fix, and --fix gives the newer Story the next free number", async () => {
    const older =
      "---\ntitle: Older\nstage: DONE\nuid: 625fd297-49d9-4880-8631-43cfd589bd8f\ncreatedAt: 2026-01-01T00:00:00.000Z\n---\n\nOlder.\n";
    const newer =
      "---\ntitle: Newer\nstage: BACKLOG\nuid: 236c7642-a79e-4b1b-8154-eb4712bd4068\ncreatedAt: 2026-02-01T00:00:00.000Z\n---\n\nNewer.\n";
    await project.write("stories/DONE/ROW-77.md", older);
    await project.write("stories/BACKLOG/ROW-77.md", newer);
    await project.write(
      "stories/DONE/ROW-78.md",
      "---\ntitle: Last\nstage: DONE\nuid: d55b3060-7c2a-4a26-8634-7d6edb789f6b\n---\n",
    );

    const before = await doctor({}, project.ctx);
    expect(before.ok).toBe(false);
    expect(before.issues).toEqual([
      {
        severity: "error",
        message: `Story ID ROW-77 is also used by ${join(".rowbly", "stories", "DONE", "ROW-77.md")}`,
        file: join(".rowbly", "stories", "BACKLOG", "ROW-77.md"),
        fix: "ROW-77 → ROW-79: duplicate ID",
        fixed: false,
      },
    ]);
    expect(await project.read("stories/BACKLOG/ROW-77.md")).toBe(newer);
    expect(await pathExists(project.path("stories/BACKLOG/ROW-79.md"))).toBe(false);

    const fixed = await doctor({ fix: true }, project.ctx);
    expect(fixed.ok).toBe(true);
    expect(fixed.issues.map(({ message, file, fixed }) => [message, file, fixed])).toEqual([
      ["ROW-77 → ROW-79: duplicate ID", join(".rowbly", "stories", "BACKLOG", "ROW-77.md"), true],
    ]);
    expect(await project.read("stories/DONE/ROW-77.md")).toBe(older);
    expect(await pathExists(project.path("stories/BACKLOG/ROW-77.md"))).toBe(false);
    expect(await project.read("stories/BACKLOG/ROW-79.md")).toContain("title: Newer");
    expect(await doctor({}, project.ctx)).toMatchObject({ issues: [], ok: true });
  });

  it("--fix gives a new number to a Story with a uid and factory state, and reports the references that stayed", async () => {
    const older =
      "---\ntitle: Older\nstage: DONE\nuid: 625fd297-49d9-4880-8631-43cfd589bd8f\ncreatedAt: 2026-01-01T00:00:00.000Z\n---\n\nOlder.\n";
    const newer =
      "---\ntitle: Newer\nstage: BACKLOG\nuid: 236c7642-a79e-4b1b-8154-eb4712bd4068\ncreatedAt: 2026-02-01T00:00:00.000Z\n---\n\nNewer.\n";
    const attempts = [
      { story: "ROW-77", stage: "DONE", workerId: "worker-1", status: "completed" },
      { story: "ROW-77", stage: "BACKLOG", workerId: "worker-2", status: "completed" },
    ];
    await project.write("stories/DONE/ROW-77.md", older);
    await project.write("stories/BACKLOG/ROW-77.md", newer);
    await project.write(
      "stories/DONE/ROW-78.md",
      "---\ntitle: Last\nstage: DONE\nuid: d55b3060-7c2a-4a26-8634-7d6edb789f6b\ndependsOn:\n  - ROW-77\n---\n",
    );
    await project.write("specs/design.md", "---\ntitle: Design\nstories: [ROW-77]\n---\n\nBody\n");
    await project.write("state.json", JSON.stringify({ version: 1, updatedAt: null, scan: { stages: {} }, attempts }));

    const fixed = await doctor({ fix: true }, project.ctx);
    const duplicate = fixed.issues.find((issue) => issue.message === "ROW-77 → ROW-79: duplicate ID");

    expect(duplicate).toEqual({
      severity: "error",
      message: "ROW-77 → ROW-79: duplicate ID",
      file: join(".rowbly", "stories", "BACKLOG", "ROW-77.md"),
      fix:
        `Give it the next free number. ${join(".rowbly", "stories", "DONE", "ROW-77.md")} keeps ROW-77. ` +
        `These references stayed with ROW-77: ${join(".rowbly", "stories", "DONE", "ROW-78.md")} (dependsOn), ` +
        `${join(".rowbly", "specs", "design.md")} (Spec link), 2 attempts without storyUid`,
      fixed: true,
    });
    expect(await project.read("stories/DONE/ROW-77.md")).toBe(older);
    expect(await project.read("stories/BACKLOG/ROW-79.md")).toContain("title: Newer");
  });

  it("reports an old copy of a Story with a fix, and --fix removes it", async () => {
    const copy = (stage: string, updatedAt: string) =>
      `---\ntitle: Search\nstage: ${stage}\nuid: 8a3c3f0e-6a55-4f43-9a0b-6f5b1e2d7c11\n` +
      `createdAt: 2026-11-01T00:00:00.000Z\nupdatedAt: ${updatedAt}\n---\n\nSearch.\n`;
    const older = copy("DONE", "2026-11-16T10:00:00.000Z");
    const newer = copy("BACKLOG", "2026-11-16T11:00:00.000Z");
    await project.write("stories/DONE/ROW-78.md", older);
    await project.write("stories/BACKLOG/ROW-78.md", newer);

    const before = await doctor({}, project.ctx);
    expect(before.ok).toBe(false);
    expect(before.issues).toEqual([
      {
        severity: "error",
        message: `Story ID ROW-78 is also used by ${join(".rowbly", "stories", "BACKLOG", "ROW-78.md")}`,
        file: join(".rowbly", "stories", "DONE", "ROW-78.md"),
        fix: `Remove the old copy. ${join(".rowbly", "stories", "BACKLOG", "ROW-78.md")} is the newest copy`,
        fixed: false,
      },
    ]);
    expect(await project.read("stories/DONE/ROW-78.md")).toBe(older);
    expect(await project.read("stories/BACKLOG/ROW-78.md")).toBe(newer);

    const fixed = await doctor({ fix: true }, project.ctx);
    expect(fixed.ok).toBe(true);
    expect(fixed.issues.map(({ message, file, fixed }) => [message, file, fixed])).toEqual([
      ["ROW-78: removed the old copy in DONE", join(".rowbly", "stories", "DONE", "ROW-78.md"), true],
    ]);
    expect(await pathExists(project.path("stories/DONE/ROW-78.md"))).toBe(false);
    expect(await project.read("stories/BACKLOG/ROW-78.md")).toBe(newer);
    expect(await doctor({}, project.ctx)).toMatchObject({ issues: [], ok: true });
  });

  it("reports two files with the same Story ID and a running attempt with no fix, and --fix does not change them", async () => {
    await project.write(
      "stories/ROW-01.md",
      "---\ntitle: Flat\nstage: BACKLOG\nuid: 745e3db6-a7ff-450e-8a72-b39482f0882d\n---\n",
    );
    await project.write(
      "stories/BACKLOG/ROW-01.md",
      "---\ntitle: Folder\nstage: BACKLOG\nuid: b0f2b97d-c5d2-476b-86e0-40408bb1d8af\n---\n",
    );
    await project.write(
      "stories/DONE/ROW-02.md",
      "---\ntitle: Two\nstage: DONE\nuid: aada29da-ee1d-44ed-8fe9-07043855cb7e\n---\n",
    );
    await project.write(
      "stories/BACKLOG/ROW-02.md",
      "---\ntitle: Two again\nstage: BACKLOG\nuid: 8fff7b05-2f31-42bf-8ad8-efe58882da0c\n---\n",
    );
    const attempts = [
      { story: "ROW-01", stage: "BACKLOG" },
      { story: "ROW-02", stage: "DONE" },
      { story: "ROW-02", stage: "BACKLOG" },
    ].map((attempt) => ({ ...attempt, workerId: "worker-1", status: "running" }));
    await project.write("state.json", JSON.stringify({ version: 1, updatedAt: null, scan: { stages: {} }, attempts }));
    const report = await doctor({ fix: true }, project.ctx);
    expect(report.ok).toBe(false);
    expect(
      report.issues.map(({ severity, message, file, fix, fixed }) => [severity, message, file, fix, fixed]),
    ).toEqual([
      [
        "warning",
        "Story file is not in the folder of its Stage BACKLOG",
        join(".rowbly", "stories", "ROW-01.md"),
        undefined,
        false,
      ],
      [
        "error",
        `Story ID ROW-01 is also used by ${join(".rowbly", "stories", "ROW-01.md")}`,
        join(".rowbly", "stories", "BACKLOG", "ROW-01.md"),
        undefined,
        false,
      ],
      [
        "error",
        `Story ID ROW-02 is also used by ${join(".rowbly", "stories", "BACKLOG", "ROW-02.md")}`,
        join(".rowbly", "stories", "DONE", "ROW-02.md"),
        undefined,
        false,
      ],
    ]);
    expect(await project.read("stories/ROW-01.md")).toBe(
      "---\ntitle: Flat\nstage: BACKLOG\nuid: 745e3db6-a7ff-450e-8a72-b39482f0882d\n---\n",
    );
    expect(await project.read("stories/BACKLOG/ROW-01.md")).toBe(
      "---\ntitle: Folder\nstage: BACKLOG\nuid: b0f2b97d-c5d2-476b-86e0-40408bb1d8af\n---\n",
    );
    expect(await project.read("stories/DONE/ROW-02.md")).toBe(
      "---\ntitle: Two\nstage: DONE\nuid: aada29da-ee1d-44ed-8fe9-07043855cb7e\n---\n",
    );
  });

  it("warns about a subfolder of stories/ with a name that is not a Stage key", async () => {
    await project.write(
      "stories/old-files/ROW-01.md",
      "---\ntitle: A\nstage: BACKLOG\nuid: 7fc56270-e7a7-4fa8-8a59-35b72eacbe29\n---\n",
    );
    expect((await doctor({}, project.ctx)).issues).toEqual([
      {
        severity: "warning",
        message: "Folder name is not a Stage key, so Rowbly does not read its Story files",
        file: join(".rowbly", "stories", "old-files"),
        fixed: false,
      },
    ]);
  });

  it("finds the Stories of Stage folders for the checks of Threads, specs and dependencies", async () => {
    await createStory({ title: "One" }, project.ctx);
    await createStory({ title: "Two", stage: "DONE", dependsOn: ["ROW-01"] }, project.ctx);
    await createThread(
      { role: "worker", storyId: "ROW-02", stage: "DONE", cwd: project.paths.root, ownerToken: "t" },
      project.ctx,
    );
    await project.write("specs/design.md", "---\ntitle: Design\nstories: [ROW-01, ROW-02]\n---\n\nBody\n");
    expect(await pathExists(project.path("stories/DONE/ROW-02.md"))).toBe(true);
    expect(await doctor({}, project.ctx)).toMatchObject({ issues: [], ok: true });
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
    await project.write(
      "stories/ROW-01.md",
      "---\ntitle: A\nstage: done\nuid: 7fc56270-e7a7-4fa8-8a59-35b72eacbe29\npoints: '3'\ndone: maybe\nextra: 1\n---\n",
    );
    await project.write(
      "stories/ROW-02.md",
      "---\nstage: NOPE\nuid: 00000000-0000-4000-8000-000000000002\npoints: null\nowner: null\ndone: null\n---\n",
    );
    await project.write(
      "stories/ROW-03.md",
      "---\ntitle: C\nuid: 00000000-0000-4000-8000-000000000003\npoints: null\nowner: null\ndone: null\n---\n",
    );

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

    const after = await doctor({ fix: true }, { ...project.ctx, now: () => new Date("2025-01-02T03:04:05.678Z") });
    expect(after.issues.filter((issue) => !issue.fixed).map((issue) => issue.message)).toEqual([
      "Done must be true or false",
      "Title is missing",
      'Unknown stage "NOPE". Stages: BACKLOG, DONE',
    ]);
    expect(after.ok).toBe(false);
    expect(await project.read("stories/DONE/ROW-01.md")).toBe(
      "---\ntitle: A\nstage: DONE\nuid: 7fc56270-e7a7-4fa8-8a59-35b72eacbe29\nupdatedAt: 2025-01-02T03:04:05.678Z\npoints: 3\nowner: null\ndone: maybe\n---\n\n",
    );
    expect(await project.read("stories/BACKLOG/ROW-03.md")).toContain("stage: BACKLOG");
    expect(await project.read("stories/ROW-02.md")).toContain("stage: NOPE");
  });

  it("accepts the position of a story", async () => {
    await project.write(
      "stories/BACKLOG/ROW-01.md",
      "---\ntitle: A\nstage: BACKLOG\nposition: 0\nuid: 7fc56270-e7a7-4fa8-8a59-35b72eacbe29\n---\n",
    );
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

  it("accepts createdAt and updatedAt in a story file", async () => {
    await project.write(
      "stories/BACKLOG/ROW-01.md",
      "---\ntitle: T\nstage: BACKLOG\nuid: b9ece18c-950a-4bfa-8b0f-dbfa4ff731d3\ncreatedAt: 2025-01-01T00:00:00.000Z\nupdatedAt: 2025-01-01T00:00:00.000Z\n---\n",
    );
    expect((await doctor({}, project.ctx)).issues).toEqual([]);
  });

  describe("old agent locks", () => {
    const BODY = "\nThe description.\n";
    const write = (lock: string) =>
      project.write(
        "stories/BACKLOG/ROW-01.md",
        `---\ntitle: T\nstage: BACKLOG\nposition: 1\nuid: b9ece18c-950a-4bfa-8b0f-dbfa4ff731d3\n${lock}\n---\n${BODY}`,
      );

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
          file: join(".rowbly", "stories", "BACKLOG", "ROW-01.md"),
          fix: "Remove it",
          fixed: false,
        },
      ]);
      const ctx = { ...project.ctx, now: () => new Date("2025-01-02T03:04:05.678Z") };
      expect((await doctor({ fix: true }, ctx)).issues).toMatchObject([{ fixed: true }]);
      expect(await project.read("stories/BACKLOG/ROW-01.md")).toBe(
        `---\ntitle: T\nstage: BACKLOG\nposition: 1\nuid: b9ece18c-950a-4bfa-8b0f-dbfa4ff731d3\nupdatedAt: 2025-01-02T03:04:05.678Z\n---\n${BODY}`,
      );
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
