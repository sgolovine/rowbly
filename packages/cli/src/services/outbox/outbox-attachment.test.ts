import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { addAttachment, removeAttachment } from "../attachment/attachment.js";
import { attachmentDir, readAttachments } from "../attachment-files/attachment-files.js";
import { createStory, updateStory } from "../story/story.js";
import { useTempDir, useTestProject } from "../test-project/test-project.js";
import type { ServiceContext } from "../workspace/workspace.js";
import { fileRecorder, outboxPaths } from "./outbox-file.js";

const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
const OTHER = Buffer.from("89504e470d0a1a0a00000000", "hex");
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

async function readEntries(dir: string) {
  const text = await readFile(outboxPaths(dir).entriesFile, "utf8").catch(() => "");
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

describe("attachment writes with the file recorder", () => {
  const project = useTestProject();
  const outbox = useTempDir();

  async function setUp() {
    const { uid } = await createStory({ title: "First" }, project.ctx);
    const ctx: ServiceContext = {
      ...project.ctx,
      now: () => new Date("2026-11-16T10:00:00.000Z"),
      recorder: fileRecorder({ dir: outbox.path, threadId: "thread-1" }),
    };
    return { ctx, uid, dir: await attachmentDir(project.paths, "ROW-01") };
  }

  it("adds the attachment to the copy and records the entry and the PNG", async () => {
    const { ctx, dir, uid } = await setUp();

    const added = await addAttachment({ story: "ROW-01", image: { name: "shot.png", bytes: PNG } }, ctx);

    expect(await readAttachments(dir)).toEqual([added]);
    expect(await readEntries(outbox.path)).toEqual([
      {
        seq: 1,
        opId: expect.any(String),
        threadId: "thread-1",
        storyId: "ROW-01",
        storyUid: uid,
        type: "attachment.add",
        attachment: {
          id: added.id,
          name: "shot.png",
          type: "image/png",
          size: PNG.length,
          createdAt: "2026-11-16T10:00:00.000Z",
          storyUid: uid,
        },
        sha256: sha(PNG),
      },
    ]);
    expect(sha(PNG)).toMatch(/^[0-9a-f]{64}$/);
    expect(await readFile(join(outboxPaths(outbox.path).blobsDir, `${sha(PNG)}.png`))).toEqual(PNG);
  });

  it("records a file that is not a PNG with its name, type and bytes", async () => {
    const { ctx, dir } = await setUp();
    const pdf = Buffer.from("%PDF-1.7\nreport\n");

    const added = await addAttachment({ story: "ROW-01", image: { name: "report.pdf", bytes: pdf } }, ctx);

    expect(added).toMatchObject({ name: "report.pdf", type: "application/pdf", size: pdf.length });
    expect(await readFile(join(dir, `${added.id}.pdf`))).toEqual(pdf);
    expect(await readEntries(outbox.path)).toEqual([
      expect.objectContaining({ type: "attachment.add", attachment: added, sha256: sha(pdf) }),
    ]);
    expect(await readFile(join(outboxPaths(outbox.path).blobsDir, `${sha(pdf)}.png`))).toEqual(pdf);

    await removeAttachment({ story: "ROW-01", id: added.id }, ctx);

    expect((await readEntries(outbox.path)).at(-1)).toMatchObject({
      type: "attachment.remove",
      id: added.id,
      sha256: sha(pdf),
    });
  });

  it("writes one blob and two entries for two adds of the same bytes", async () => {
    const { ctx } = await setUp();

    await addAttachment({ story: "ROW-01", image: { name: "a.png", bytes: PNG } }, ctx);
    await addAttachment({ story: "ROW-01", image: { name: "b.png", bytes: PNG } }, ctx);

    expect(await readdir(outboxPaths(outbox.path).blobsDir)).toEqual([`${sha(PNG)}.png`]);
    expect((await readEntries(outbox.path)).map((entry) => [entry.seq, entry.sha256])).toEqual([
      [1, sha(PNG)],
      [2, sha(PNG)],
    ]);
  });

  it("has a PNG for each entry", async () => {
    const { ctx } = await setUp();

    await addAttachment({ story: "ROW-01", image: { name: "a.png", bytes: PNG } }, ctx);
    await addAttachment({ story: "ROW-01", image: { name: "b.png", bytes: OTHER } }, ctx);

    const blobs = await readdir(outboxPaths(outbox.path).blobsDir);
    const entries = await readEntries(outbox.path);
    expect(entries).toHaveLength(2);
    for (const entry of entries) expect(blobs).toContain(`${entry.sha256}.png`);
  });

  it("keeps the PNG in blobs/ when the entry append fails after the blob write", async () => {
    const recorder = fileRecorder({ dir: outbox.path, threadId: "t" });
    // A folder in place of outbox.jsonl makes the append fail.
    await mkdir(outboxPaths(outbox.path).entriesFile, { recursive: true });
    const attachment = {
      id: "a00000000-0000-4000-8000-000000000001",
      name: "a.png",
      type: "image/png" as const,
      size: PNG.length,
      createdAt: "2026-11-16T10:00:00.000Z",
    };

    await expect(recorder.recordAttachmentAdd({ storyId: "ROW-01", attachment, bytes: PNG })).rejects.toThrow();

    expect(await readFile(join(outboxPaths(outbox.path).blobsDir, `${sha(PNG)}.png`))).toEqual(PNG);
  });

  it("writes no entry when the blob write fails", async () => {
    const recorder = fileRecorder({ dir: outbox.path, threadId: "t" });
    // A file in place of the blobs folder makes the blob write fail.
    await writeFile(outboxPaths(outbox.path).blobsDir, "");
    const attachment = {
      id: "a00000000-0000-4000-8000-000000000001",
      name: "a.png",
      type: "image/png" as const,
      size: PNG.length,
      createdAt: "2026-11-16T10:00:00.000Z",
    };

    await expect(recorder.recordAttachmentAdd({ storyId: "ROW-01", attachment, bytes: PNG })).rejects.toThrow();

    expect(await readEntries(outbox.path)).toEqual([]);
  });

  it("removes the attachment from the copy and records the id and the sha256", async () => {
    const { ctx, dir, uid } = await setUp();
    const added = await addAttachment({ story: "ROW-01", image: { name: "a.png", bytes: PNG } }, project.ctx);

    await removeAttachment({ story: "ROW-01", id: added.id }, ctx);

    expect(await readAttachments(dir)).toEqual([]);
    expect(await readdir(dir)).not.toContain(`${added.id}.png`);
    expect(await readEntries(outbox.path)).toEqual([
      {
        seq: 1,
        opId: expect.any(String),
        threadId: "thread-1",
        storyId: "ROW-01",
        storyUid: uid,
        type: "attachment.remove",
        id: added.id,
        sha256: sha(PNG),
      },
    ]);
  });

  it("keeps field entries without a type", async () => {
    const { ctx, uid } = await setUp();

    await updateStory({ id: "ROW-01", title: "Renamed" }, ctx);

    expect(await readEntries(outbox.path)).toEqual([
      {
        seq: 1,
        opId: expect.any(String),
        threadId: "thread-1",
        storyId: "ROW-01",
        storyUid: uid,
        changes: [{ path: "title", before: "First", after: "Renamed" }],
      },
    ]);
  });

  it("records no entry when the add fails", async () => {
    const { ctx } = await setUp();

    await expect(
      addAttachment({ story: "ROW-01", image: { name: "a.png", bytes: PNG }, id: "bad" }, ctx),
    ).rejects.toMatchObject({ code: "VALIDATION" });

    expect(await readEntries(outbox.path)).toEqual([]);
  });
});
