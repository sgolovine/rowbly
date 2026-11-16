import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { addAttachment } from "../attachment/attachment.js";
import { addCustomField, removeCustomField, updateCustomField } from "../custom-field/custom-field.js";
import { doctor } from "../doctor/doctor.js";
import { addCheck } from "../factory-settings/check-items.js";
import { configureGit, updateFactorySettings } from "../factory-settings/factory-settings.js";
import { updateProject } from "../project/project.js";
import { setPrompt } from "../prompts/prompts.js";
import { createSpec, deleteSpec, linkSpec, unlinkSpec, updateSpec } from "../spec/spec.js";
import { createStage, deleteStage, updateStage } from "../stage/stage.js";
import { createStory, deleteStory, getStory, touchStory, updateStory } from "../story/story.js";
import { repairDuplicateStoryIds } from "../story-renumber/story-renumber.js";
import { addTag, removeTag, updateTag } from "../tag/tag.js";
import { useTempDir, useTestProject } from "../test-project/test-project.js";
import type { ServiceContext } from "../workspace/workspace.js";
import { type FieldChange, refuseRemoteWrite, type StoryWrite, storyChanges, type WriteRecorder } from "./outbox.js";
import { appendOutboxEntry, fileRecorder, outboxPaths } from "./outbox-file.js";

const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");

/** A recorder that keeps the writes in memory. */
function memoryRecorder(): WriteRecorder & { writes: StoryWrite[] } {
  const writes: StoryWrite[] = [];
  return {
    writes,
    record: async (write) => void writes.push(write),
    recordAttachmentAdd: async () => undefined,
    recordAttachmentRemove: async () => undefined,
  };
}

/** Each file in the folder with its bytes and its modification time. */
async function snapshot(dir: string): Promise<Record<string, string>> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  const files = entries.filter((entry) => entry.isFile());
  const pairs = await Promise.all(
    files.map(async (entry) => {
      const path = join(entry.parentPath, entry.name);
      const info = await stat(path);
      return [relative(dir, path), `${info.mtimeMs}:${(await readFile(path)).toString("base64")}`];
    }),
  );
  return Object.fromEntries(pairs);
}

async function readEntries(dir: string) {
  const text = await readFile(outboxPaths(dir).entriesFile, "utf8");
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

describe("storyChanges", () => {
  it("gives one change for each changed path, with full lists", () => {
    const before = { data: { title: "A", stage: "BACKLOG", owner: "sam", tags: ["x"] }, body: "one" };
    const after = {
      data: { title: "B", stage: "DONE", owner: null, tags: ["x", "y"], dependsOn: ["ROW-02"], updatedAt: "now" },
      body: "two",
    };
    expect(storyChanges(["owner"], before, after)).toEqual<FieldChange[]>([
      { path: "title", before: "A", after: "B" },
      { path: "description", before: "one", after: "two" },
      { path: "stage", before: "BACKLOG", after: "DONE" },
      { path: "fields.owner", before: "sam", after: null },
      { path: "tags", before: ["x"], after: ["x", "y"] },
      { path: "dependsOn", before: [], after: ["ROW-02"] },
    ]);
  });

  it("ignores derived values", () => {
    const before = { data: { title: "A", createdAt: "1", updatedAt: "1", position: 1 }, body: "" };
    const after = { data: { title: "A", createdAt: "2", updatedAt: "2", position: 2 }, body: "" };
    expect(storyChanges([], before, after)).toEqual([]);
  });
});

describe("refuseRemoteWrite", () => {
  it("does nothing without a recorder", () => {
    expect(() => refuseRemoteWrite({}, "create a Story")).not.toThrow();
  });

  it("throws a ConflictError with a recorder", () => {
    expect(() => refuseRemoteWrite({ recorder: memoryRecorder() }, "create a Story")).toThrow(
      expect.objectContaining({ code: "CONFLICT", message: "A remote worker cannot create a Story" }),
    );
  });
});

describe("Story writes with a recorder", () => {
  const project = useTestProject();

  async function setUp() {
    await addCustomField({ label: "Owner", type: "string" }, project.ctx);
    await addTag({ label: "Bug", value: "bug" }, project.ctx);
    await createStory({ title: "Upstream" }, project.ctx);
    await createStory({ title: "First", description: "old" }, project.ctx);
    const recorder = memoryRecorder();
    return { recorder, ctx: { ...project.ctx, recorder } };
  }

  it("records each changed path of an update", async () => {
    const { recorder, ctx } = await setUp();

    await updateStory({ id: "ROW-02", title: "Renamed" }, ctx);
    await updateStory({ id: "ROW-02", description: "new" }, ctx);
    await updateStory({ id: "ROW-02", stage: "DONE" }, ctx);
    await updateStory({ id: "ROW-02", fields: { owner: "sam" } }, ctx);
    await updateStory({ id: "ROW-02", tags: ["bug"] }, ctx);
    await updateStory({ id: "ROW-02", addDependsOn: ["ROW-01"] }, ctx);

    const storyUid = (await getStory({ id: "ROW-02" }, project.ctx)).uid;
    expect(storyUid).toEqual(expect.any(String));
    expect(recorder.writes).toEqual([
      { storyId: "ROW-02", storyUid, changes: [{ path: "title", before: "First", after: "Renamed" }] },
      { storyId: "ROW-02", storyUid, changes: [{ path: "description", before: "old", after: "new" }] },
      { storyId: "ROW-02", storyUid, changes: [{ path: "stage", before: "BACKLOG", after: "DONE" }] },
      { storyId: "ROW-02", storyUid, changes: [{ path: "fields.owner", before: null, after: "sam" }] },
      { storyId: "ROW-02", storyUid, changes: [{ path: "tags", before: [], after: ["bug"] }] },
      { storyId: "ROW-02", storyUid, changes: [{ path: "dependsOn", before: [], after: ["ROW-01"] }] },
    ]);
    expect(await getStory({ id: "ROW-02" }, project.ctx)).toMatchObject({ title: "Renamed", stage: "DONE" });
  });

  it("records a write without a storyUid for a Story without a uid, with no error", async () => {
    const { recorder, ctx } = await setUp();
    const path = "stories/BACKLOG/ROW-02.md";
    await project.write(path, (await project.read(path)).replace(/\nuid: [^\n]*\n/, "\n"));

    await updateStory({ id: "ROW-02", title: "Renamed" }, ctx);

    expect(recorder.writes).toEqual([
      { storyId: "ROW-02", changes: [{ path: "title", before: "First", after: "Renamed" }] },
    ]);
    expect("storyUid" in (recorder.writes[0] ?? {})).toBe(false);
  });

  it("records several paths of one update in one entry, without derived values", async () => {
    const { recorder, ctx } = await setUp();

    await updateStory({ id: "ROW-02", title: "Renamed", stage: "DONE" }, ctx);

    expect(recorder.writes).toHaveLength(1);
    const paths = recorder.writes[0]?.changes.map((change) => change.path);
    expect(paths).toEqual(["title", "stage"]);
    expect(JSON.stringify(recorder.writes)).not.toMatch(/updatedAt|position|createdAt/);
  });

  it("records nothing for an update without a change and for a touch", async () => {
    const { recorder, ctx } = await setUp();

    await updateStory({ id: "ROW-02", title: "First", description: "old", stage: "BACKLOG" }, ctx);
    await updateStory({ id: "ROW-02", addDependsOn: [] }, ctx);
    await touchStory({ id: "ROW-02" }, ctx);

    expect(recorder.writes).toEqual([]);
  });

  it("records no entry when the update fails", async () => {
    const { recorder, ctx } = await setUp();

    await expect(updateStory({ id: "ROW-02", stage: "NOPE" }, ctx)).rejects.toMatchObject({ code: "VALIDATION" });
    expect(recorder.writes).toEqual([]);
  });
});

describe("refused writes with a recorder", () => {
  const project = useTestProject();

  async function setUp() {
    await addCustomField({ label: "Owner", type: "string" }, project.ctx);
    await addTag({ label: "Bug", value: "bug" }, project.ctx);
    await updateProject({ features: { specs: true } }, project.ctx);
    const story = await createStory({ title: "First" }, project.ctx);
    await createSpec({ title: "Plan", stories: [story.id] }, project.ctx);
    await addAttachment({ story: story.id, image: { name: "shot.png", bytes: PNG } }, project.ctx);
    const recorder = memoryRecorder();
    return { recorder, ctx: { ...project.ctx, recorder } as ServiceContext };
  }

  const refused: [string, (ctx: ServiceContext) => Promise<unknown>][] = [
    ["createStory", (ctx) => createStory({ title: "New" }, ctx)],
    ["deleteStory", (ctx) => deleteStory({ id: "ROW-01" }, ctx)],
    ["createStage", (ctx) => createStage({ label: "Review" }, ctx)],
    ["updateStage", (ctx) => updateStage({ key: "DONE", label: "Finished" }, ctx)],
    ["deleteStage", (ctx) => deleteStage({ key: "DONE" }, ctx)],
    ["createSpec", (ctx) => createSpec({ title: "Other", stories: ["ROW-01"] }, ctx)],
    ["updateSpec", (ctx) => updateSpec({ slug: "plan", title: "Renamed" }, ctx)],
    ["deleteSpec", (ctx) => deleteSpec({ slug: "plan" }, ctx)],
    ["linkSpec", (ctx) => linkSpec({ slug: "plan", story: "ROW-01" }, ctx)],
    ["unlinkSpec", (ctx) => unlinkSpec({ slug: "plan", story: "ROW-01" }, ctx)],
    ["addTag", (ctx) => addTag({ label: "Docs", value: "docs" }, ctx)],
    ["updateTag", (ctx) => updateTag({ value: "bug", label: "Defect" }, ctx)],
    ["removeTag", (ctx) => removeTag({ value: "bug" }, ctx)],
    ["addCustomField", (ctx) => addCustomField({ label: "Points", type: "number" }, ctx)],
    ["updateCustomField", (ctx) => updateCustomField({ key: "owner", label: "Lead" }, ctx)],
    ["removeCustomField", (ctx) => removeCustomField({ key: "owner" }, ctx)],
    ["setPrompt", (ctx) => setPrompt({ name: "system", text: "New" }, ctx)],
    ["updateProject", (ctx) => updateProject({ name: "Other" }, ctx)],
    ["updateFactorySettings", (ctx) => updateFactorySettings({ maxWorkers: 2 }, ctx)],
    ["configureGit", (ctx) => configureGit({ commitMessage: "chore: sync" }, ctx)],
    ["addCheck", (ctx) => addCheck({ key: "lint", command: "pnpm lint" } as never, ctx)],
    ["repairDuplicateStoryIds", (ctx) => repairDuplicateStoryIds(ctx)],
    ["doctor --fix", (ctx) => doctor({ fix: true }, ctx)],
    [
      "updateStory with attachments",
      (ctx) => updateStory({ id: "ROW-01", title: "Changed", attachments: [{ name: "c.png", bytes: PNG }] }, ctx),
    ],
  ];

  it.each(refused)("refuses %s and writes no file", async (_name, call) => {
    const { recorder, ctx } = await setUp();
    const before = await snapshot(project.paths.dir);

    await expect(call(ctx)).rejects.toMatchObject({
      code: "CONFLICT",
      message: expect.stringMatching(/^A remote worker cannot /),
    });

    expect(await snapshot(project.paths.dir)).toEqual(before);
    expect(recorder.writes).toEqual([]);
  });

  it("permits doctor without --fix", async () => {
    const { ctx } = await setUp();

    await expect(doctor({}, ctx)).resolves.toMatchObject({ root: project.paths.root });
  });
});

describe("the outbox file", () => {
  const dir = useTempDir();
  const write: StoryWrite = { storyId: "ROW-01", changes: [{ path: "title", before: "A", after: "B" }] };

  it("starts at 1 and adds one durable line for each entry", async () => {
    const outbox = join(dir.path, "outbox");
    const recorder = fileRecorder({ dir: outbox, threadId: "thread-1" });

    await recorder.record(write);
    await recorder.record({ ...write, storyId: "ROW-02" });

    const entries = await readEntries(outbox);
    expect(entries.map((entry) => [entry.seq, entry.storyId, entry.threadId])).toEqual([
      [1, "ROW-01", "thread-1"],
      [2, "ROW-02", "thread-1"],
    ]);
    expect(entries[0].opId).not.toBe(entries[1].opId);
    expect(entries[0]).toEqual({ seq: 1, opId: expect.any(String), threadId: "thread-1", ...write });
    expect(await readFile(outboxPaths(outbox).seqFile, "utf8")).toBe("2\n");
  });

  it("continues the sequence after the first lines are removed", async () => {
    const outbox = dir.path;
    await appendOutboxEntry({ dir: outbox, threadId: "t" }, write);
    await appendOutboxEntry({ dir: outbox, threadId: "t" }, write);
    await writeFile(outboxPaths(outbox).entriesFile, "");

    const next = await appendOutboxEntry({ dir: outbox, threadId: "t" }, write);

    expect(next.seq).toBe(3);
    expect((await readEntries(outbox)).map((entry) => entry.seq)).toEqual([3]);
  });

  it("does not give a seq two times when the seq file is behind the lines", async () => {
    const outbox = dir.path;
    await appendOutboxEntry({ dir: outbox, threadId: "t" }, write);
    await appendOutboxEntry({ dir: outbox, threadId: "t" }, write);
    await writeFile(outboxPaths(outbox).seqFile, "1\n");

    expect((await appendOutboxEntry({ dir: outbox, threadId: "t" }, write)).seq).toBe(3);
  });

  it("gives parallel writers different seq numbers", async () => {
    const outbox = dir.path;
    const entries = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        appendOutboxEntry({ dir: outbox, threadId: `thread-${index % 2}` }, write),
      ),
    );

    expect(entries.map((entry) => entry.seq).toSorted((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect((await readEntries(outbox)).map((entry) => entry.seq)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
});
