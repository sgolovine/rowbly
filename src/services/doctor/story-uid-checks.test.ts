import { describe, expect, it } from "vitest";
import { parseMarkdown } from "../markdown/markdown.js";
import { createStory, getStory } from "../story/story.js";
import { useTestProject } from "../test-project/test-project.js";
import { doctor } from "./doctor.js";

/** A lower-case UUID v4. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const UID = "3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b";
const CREATED = "2025-01-01T00:00:00.000Z";
const LATER = "2025-02-02T00:00:00.000Z";

describe("doctor uid checks", () => {
  const project = useTestProject();
  const later = () => ({ ...project.ctx, now: () => new Date(LATER) });
  const issues = async (fix = false) =>
    (await doctor({ fix }, later())).issues.map(({ severity, message, fix: action, fixed }) => [
      severity,
      message,
      action,
      fixed,
    ]);
  const frontmatter = async (path: string) => parseMarkdown(await project.read(path), path).data;

  it("accepts a valid uid, and --fix does not remove it", async () => {
    const story = `---\ntitle: T\nstage: BACKLOG\nuid: ${UID}\ncreatedAt: ${CREATED}\nupdatedAt: ${CREATED}\n---\n\nBody\n`;
    await project.write("stories/BACKLOG/ROW-01.md", story);
    expect(await issues()).toEqual([]);
    expect(await issues(true)).toEqual([]);
    expect(await project.read("stories/BACKLOG/ROW-01.md")).toBe(story);
  });

  it("accepts the uid of a new Story", async () => {
    await createStory({ title: "T" }, project.ctx);
    expect(await issues()).toEqual([]);
  });

  it("warns about a Story without uid, and --fix adds a new uid and changes no other key", async () => {
    const story = `---\ntitle: T\nstage: BACKLOG\ncreatedAt: ${CREATED}\nupdatedAt: ${CREATED}\n---\n\nBody\n`;
    await project.write("stories/BACKLOG/ROW-01.md", story);
    const before = await frontmatter("stories/BACKLOG/ROW-01.md");

    expect(await issues()).toEqual([["warning", "Story has no uid", "Add a new uid", false]]);
    expect(await project.read("stories/BACKLOG/ROW-01.md")).not.toContain("uid");
    expect(await issues(true)).toEqual([["warning", "Story has no uid", "Add a new uid", true]]);

    const after = await frontmatter("stories/BACKLOG/ROW-01.md");
    expect(after.uid).toMatch(UUID);
    expect({ ...after, uid: undefined }).toEqual({ ...before, uid: undefined });
    expect(after.updatedAt).toBe(CREATED);
    expect((await project.read("stories/BACKLOG/ROW-01.md")).endsWith("---\n\nBody\n")).toBe(true);
    expect((await getStory({ id: "ROW-01" }, project.ctx)).uid).toBe(after.uid);
    expect(await issues()).toEqual([]);
  });

  it("gives each Story without uid a different uid", async () => {
    await project.write("stories/BACKLOG/ROW-01.md", "---\ntitle: One\nstage: BACKLOG\n---\n");
    await project.write("stories/BACKLOG/ROW-02.md", "---\ntitle: Two\nstage: BACKLOG\n---\n");
    await doctor({ fix: true }, project.ctx);
    const one = await getStory({ id: "ROW-01" }, project.ctx);
    const two = await getStory({ id: "ROW-02" }, project.ctx);
    expect(one.uid).toMatch(UUID);
    expect(two.uid).toMatch(UUID);
    expect(one.uid).not.toBe(two.uid);
  });

  it("gives a new updatedAt when --fix also changes the content of the Story", async () => {
    await project.write("stories/BACKLOG/ROW-01.md", `---\ntitle: T\nstage: backlog\nupdatedAt: ${CREATED}\n---\n`);
    await doctor({ fix: true }, later());
    const after = await frontmatter("stories/BACKLOG/ROW-01.md");
    expect(after.uid).toMatch(UUID);
    expect(after.stage).toBe("BACKLOG");
    expect(after.updatedAt).toBe(LATER);
  });

  it.each([
    ["a text that is not a UUID", "not-a-uuid", 'uid "not-a-uuid" is not a UUID'],
    ["a number", "42", 'uid "42" is not a UUID'],
    ["an empty text", "''", 'uid "" is not a UUID'],
  ])("reports %s as an error, and --fix does not change it", async (_name, value, message) => {
    const story = `---\ntitle: T\nstage: BACKLOG\nuid: ${value}\n---\n\nBody\n`;
    await project.write("stories/BACKLOG/ROW-01.md", story);
    expect(await issues()).toEqual([["error", message, undefined, false]]);
    expect(await issues(true)).toEqual([["error", message, undefined, false]]);
    expect(await project.read("stories/BACKLOG/ROW-01.md")).toBe(story);
  });

  it("keeps the uid when --fix gives a duplicate Story ID a new number", async () => {
    const other = "4a5b6c7d-8e9f-4a0b-8c1d-2e3f4a5b6c7d";
    await project.write(
      "stories/DONE/ROW-07.md",
      `---\ntitle: Older\nstage: DONE\nuid: ${UID}\ncreatedAt: 2026-01-01T00:00:00.000Z\n---\n`,
    );
    await project.write(
      "stories/BACKLOG/ROW-07.md",
      `---\ntitle: Newer\nstage: BACKLOG\nuid: ${other}\ncreatedAt: 2026-02-01T00:00:00.000Z\n---\n`,
    );
    await doctor({ fix: true }, project.ctx);
    expect((await getStory({ id: "ROW-07" }, project.ctx)).uid).toBe(UID);
    expect((await getStory({ id: "ROW-08" }, project.ctx)).uid).toBe(other);
  });
});
