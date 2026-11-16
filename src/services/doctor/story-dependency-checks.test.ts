import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { addCustomField } from "../custom-field/custom-field.js";
import { parseMarkdown } from "../markdown/markdown.js";
import { useTestProject } from "../test-project/test-project.js";
import { doctor } from "./doctor.js";

describe("doctor Story dependency checks", () => {
  const project = useTestProject();

  /** A fixed uid for each Story ID, so that the files of the tests have no uid warning. */
  const uidOf = (id: string) => `00000000-0000-4000-8000-${id.replace(/\D/g, "").padStart(12, "0")}`;
  const story = (id: string, dependsOn?: string) =>
    project.write(
      `stories/BACKLOG/${id}.md`,
      `---\ntitle: Story ${id}\nstage: BACKLOG\nuid: ${uidOf(id)}\n${dependsOn === undefined ? "" : `dependsOn: ${dependsOn}\n`}---\n\nBody of ${id}.\n`,
    );
  const storyFile = (id: string) => join(".rowbly", "stories", "BACKLOG", `${id}.md`);
  const readStory = async (id: string) =>
    parseMarkdown(await readFile(join(join(project.paths.storiesDir, "BACKLOG"), `${id}.md`), "utf8"), id);
  const summary = async (fix = false) =>
    (await doctor({ fix }, project.ctx)).issues.map(({ severity, message, file, fix: canFix, fixed }) => ({
      severity,
      message,
      file,
      fix: canFix,
      fixed,
    }));
  const snapshot = async () => {
    const names = (await readdir(join(project.paths.storiesDir, "BACKLOG"))).toSorted();
    return Promise.all(names.map((name) => readFile(join(join(project.paths.storiesDir, "BACKLOG"), name))));
  };

  it("accepts a valid list, and --fix keeps it", async () => {
    await story("ROW-01");
    await story("ROW-02");
    await story("ROW-03", "[ROW-02, ROW-01]");
    const before = await readFile(join(join(project.paths.storiesDir, "BACKLOG"), "ROW-03.md"), "utf8");

    expect(await doctor({}, project.ctx)).toMatchObject({ issues: [], ok: true });
    expect(await doctor({ fix: true }, project.ctx)).toMatchObject({ issues: [], ok: true });
    expect(await readFile(join(join(project.paths.storiesDir, "BACKLOG"), "ROW-03.md"), "utf8")).toBe(before);
    expect((await readStory("ROW-03")).data.dependsOn).toEqual(["ROW-02", "ROW-01"]);
  });

  it("reports an ID in a different form, and corrects it", async () => {
    await story("ROW-01");
    await story("ROW-02", "[row-1]");

    expect(await summary()).toEqual([
      {
        severity: "error",
        message: 'dependsOn: Story ID "row-1" should be ROW-01',
        file: storyFile("ROW-02"),
        fix: "Correct it",
        fixed: false,
      },
    ]);
    expect((await summary(true)).map((issue) => issue.fixed)).toEqual([true]);
    expect((await readStory("ROW-02")).data.dependsOn).toEqual(["ROW-01"]);
    expect(await doctor({}, project.ctx)).toMatchObject({ issues: [], ok: true });
  });

  it("reports an ID that is not a Story of the project, and removes it", async () => {
    await story("ROW-01");
    await story("ROW-02", "[ROW-09, ROW-01, WEB-01, oops]");

    expect(await summary()).toEqual(
      ["ROW-09", "WEB-01", "oops"].map((id) => ({
        severity: "error",
        message: `dependsOn: "${id}" is not a Story of this project`,
        file: storyFile("ROW-02"),
        fix: "Remove the ID",
        fixed: false,
      })),
    );
    expect((await doctor({ fix: true }, project.ctx)).ok).toBe(true);
    expect((await readStory("ROW-02")).data.dependsOn).toEqual(["ROW-01"]);
    expect(await doctor({}, project.ctx)).toMatchObject({ issues: [], ok: true });
  });

  it("reports a self reference, and removes it", async () => {
    await story("ROW-01");
    await story("ROW-02", "[ROW-02, ROW-01]");

    expect(await summary()).toEqual([
      {
        severity: "error",
        message: "dependsOn: ROW-02 depends on itself",
        file: storyFile("ROW-02"),
        fix: "Remove the ID",
        fixed: false,
      },
    ]);
    await doctor({ fix: true }, project.ctx);
    expect((await readStory("ROW-02")).data.dependsOn).toEqual(["ROW-01"]);
    expect(await doctor({}, project.ctx)).toMatchObject({ issues: [], ok: true });
  });

  it("warns about a duplicate, and removes the later copy", async () => {
    await story("ROW-01");
    await story("ROW-02");
    await story("ROW-03", "[ROW-02, ROW-01, ROW-02]");

    const report = await doctor({}, project.ctx);
    expect(report.ok).toBe(true);
    expect(await summary()).toEqual([
      {
        severity: "warning",
        message: "dependsOn: ROW-02 is in the list more than one time",
        file: storyFile("ROW-03"),
        fix: "Remove the duplicate",
        fixed: false,
      },
    ]);
    await doctor({ fix: true }, project.ctx);
    expect((await readStory("ROW-03")).data.dependsOn).toEqual(["ROW-02", "ROW-01"]);
    expect(await doctor({}, project.ctx)).toMatchObject({ issues: [], ok: true });
  });

  it("warns about an empty list, and removes the key", async () => {
    await story("ROW-01", "[]");

    expect(await summary()).toEqual([
      {
        severity: "warning",
        message: "dependsOn is an empty list",
        file: storyFile("ROW-01"),
        fix: "Remove the key",
        fixed: false,
      },
    ]);
    await doctor({ fix: true }, project.ctx);
    expect("dependsOn" in (await readStory("ROW-01")).data).toBe(false);
    expect(await doctor({}, project.ctx)).toMatchObject({ issues: [], ok: true });
  });

  it("removes the key when the fixes make the list empty", async () => {
    await story("ROW-01", "[ROW-01, ROW-09]");

    expect((await summary()).map((issue) => issue.message)).toEqual([
      'dependsOn: "ROW-09" is not a Story of this project',
      "dependsOn: ROW-01 depends on itself",
    ]);
    expect((await summary(true)).map((issue) => [issue.message, issue.fixed])).toEqual([
      ['dependsOn: "ROW-09" is not a Story of this project', true],
      ["dependsOn: ROW-01 depends on itself", true],
      ["dependsOn is an empty list", true],
    ]);
    expect("dependsOn" in (await readStory("ROW-01")).data).toBe(false);
    expect(await doctor({}, project.ctx)).toMatchObject({ issues: [], ok: true });
  });

  it.each([
    ["a text", "ROW-01"],
    ["a list with a number", "[ROW-01, 2]"],
    ["a map", "{ a: ROW-01 }"],
  ])("reports %s as not a list of strings, with no fix", async (_name, value) => {
    await story("ROW-01");
    await story("ROW-02", value);
    const before = await readFile(join(join(project.paths.storiesDir, "BACKLOG"), "ROW-02.md"), "utf8");

    expect(await summary()).toEqual([
      {
        severity: "error",
        message: "dependsOn is not a list of strings",
        file: storyFile("ROW-02"),
        fix: undefined,
        fixed: false,
      },
    ]);
    const report = await doctor({ fix: true }, project.ctx);
    expect(report.ok).toBe(false);
    expect(report.issues).toHaveLength(1);
    expect(await readFile(join(join(project.paths.storiesDir, "BACKLOG"), "ROW-02.md"), "utf8")).toBe(before);
  });

  it("reports a cycle of three Stories one time", async () => {
    await story("ROW-01", "[ROW-03]");
    await story("ROW-02", "[ROW-01]");
    await story("ROW-03", "[ROW-02]");

    const report = await doctor({ fix: true }, project.ctx);
    expect(report.ok).toBe(false);
    expect(report.issues).toEqual([
      {
        severity: "error",
        message:
          'The dependencies make a cycle: ROW-01 → ROW-03 → ROW-02 → ROW-01. Remove one dependency, for example with "rowbly story update ROW-01 --remove-dependency ROW-03"',
        file: storyFile("ROW-01"),
        fixed: false,
      },
    ]);
    expect((await readStory("ROW-01")).data.dependsOn).toEqual(["ROW-03"]);
  });

  it("reports two separate cycles as two errors", async () => {
    await story("ROW-01", "[ROW-02]");
    await story("ROW-02", "[ROW-01]");
    await story("ROW-03", "[ROW-04]");
    await story("ROW-04", "[ROW-03]");

    const report = await doctor({}, project.ctx);
    expect(report.ok).toBe(false);
    expect(report.issues.map(({ message, file }) => [message.split(".")[0], file])).toEqual([
      ["The dependencies make a cycle: ROW-01 → ROW-02 → ROW-01", storyFile("ROW-01")],
      ["The dependencies make a cycle: ROW-03 → ROW-04 → ROW-03", storyFile("ROW-03")],
    ]);
  });

  it("ignores the reported IDs in the cycle check", async () => {
    await story("ROW-01", "[ROW-01, ROW-02]");
    await story("ROW-02");

    expect((await summary()).map((issue) => issue.message)).toEqual(["dependsOn: ROW-01 depends on itself"]);
  });

  it("skips a Story with invalid frontmatter and checks the other Stories", async () => {
    await project.write("stories/BACKLOG/ROW-01.md", "---\ntitle: [oops\n---\n");
    await story("ROW-02", "[ROW-01, ROW-09]");

    const messages = (await doctor({}, project.ctx)).issues.map((issue) => issue.message);
    expect(messages[0]).toMatch(/^Invalid frontmatter: /);
    expect(messages.slice(1)).toEqual(['dependsOn: "ROW-09" is not a Story of this project']);
  });

  it("keeps the order, the other keys and the description when it fixes a list", async () => {
    await addCustomField({ label: "Owner", type: "string" }, project.ctx);
    await story("ROW-01");
    await story("ROW-02");
    await story("ROW-03");
    await project.write(
      "stories/BACKLOG/ROW-04.md",
      `---\ntitle: Four\nstage: BACKLOG\nposition: 2\nuid: ${uidOf("ROW-04")}\ndependsOn: [ROW-03, row-1, ROW-09, ROW-03, ROW-02]\nowner: Ann\n---\n\n## Goal\n\nKeep this text.\n`,
    );
    const before = await readStory("ROW-04");

    await doctor({ fix: true }, { ...project.ctx, now: () => new Date("2025-01-02T03:04:05.678Z") });
    const after = await readStory("ROW-04");
    expect(after.data).toEqual({
      title: "Four",
      stage: "BACKLOG",
      position: 2,
      uid: uidOf("ROW-04"),
      dependsOn: ["ROW-03", "ROW-01", "ROW-02"],
      updatedAt: "2025-01-02T03:04:05.678Z",
      owner: "Ann",
    });
    expect(Object.keys(after.data).filter((key) => key !== "updatedAt")).toEqual(Object.keys(before.data));
    expect(after.body).toBe(before.body);
    expect(await doctor({}, project.ctx)).toMatchObject({ issues: [], ok: true });
  });

  it("changes no Story file without --fix", async () => {
    await story("ROW-01", "[]");
    await story("ROW-02", "[row-1, ROW-09, ROW-02, ROW-01, ROW-01]");
    await story("ROW-03", "[ROW-04]");
    await story("ROW-04", "[ROW-03]");
    await story("ROW-05", "oops");
    const before = await snapshot();

    expect((await doctor({}, project.ctx)).issues.length).toBeGreaterThan(0);
    expect(await snapshot()).toEqual(before);
  });
});
