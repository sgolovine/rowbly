import { createHash } from "node:crypto";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { listAttachments } from "../attachment/attachment.js";
import { createStory, getStory } from "../story/story.js";
import { useTestProject } from "../test-project/test-project.js";
import { createThread, transitionThread } from "../thread/thread.js";
import { hasHeldEntries, heldAction } from "./held-actions.js";
import { readHeldEntries } from "./held-entries.js";
import { applyOutbox } from "./outbox-apply.js";

const HOST = "mini";
const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
const HASH = createHash("sha256").update(PNG).digest("hex");
const ATTACHMENT = {
  id: `a${"1".repeat(36)}`,
  name: "shot.png",
  type: "image/png",
  size: 16,
  createdAt: "2026-11-16T10:00:00.000Z",
};

describe("thread held actions", () => {
  const project = useTestProject();
  let threadId: string;

  async function abandonedThread(host = HOST) {
    const thread = await createThread(
      { role: "worker", storyId: "ROW-01", stage: "BACKLOG", cwd: project.paths.root, ownerToken: "o", host },
      project.ctx,
    );
    const abandoned = { at: "2026-11-16T10:00:00.000Z", reason: "cancel" as const, appliedSeq: 0 };
    await transitionThread(thread.id, { expectedRevision: 1, status: "cancelled", patch: { abandoned } }, project.ctx);
    return thread.id;
  }

  beforeEach(async () => {
    await createStory({ title: "First" }, project.ctx);
    threadId = await abandonedThread();
    const entries = [
      { seq: 1, opId: "a", threadId, storyId: "ROW-01", changes: [{ path: "title", before: "First", after: "Late" }] },
      { seq: 2, opId: "b", threadId, storyId: "ROW-01", type: "attachment.add", attachment: ATTACHMENT, sha256: HASH },
      { seq: 3, opId: "c", threadId, storyId: "ROW-01", changes: [{ path: "title", before: "Other", after: "X" }] },
    ];
    await applyOutbox(
      { host: HOST, entries, source: { blob: async () => PNG }, abandoned: [{ threadId, appliedSeq: 0 }] },
      project.ctx,
    );
  });

  it("lists the held entries with their Story, paths and attachment ids", async () => {
    expect(await heldAction({ id: threadId }, project.ctx)).toEqual({
      action: "list",
      threadId,
      host: HOST,
      entries: [
        { seq: 1, storyId: "ROW-01", type: "fields", paths: ["title"] },
        { seq: 2, storyId: "ROW-01", type: "attachment.add", attachmentId: ATTACHMENT.id },
        { seq: 3, storyId: "ROW-01", type: "fields", paths: ["title"] },
      ],
    });
    expect((await getStory({ id: "ROW-01" }, project.ctx)).title).toBe("First");
  });

  it("applies the held entries, keeps an entry with a conflict, and a second apply changes nothing", async () => {
    const first = await heldAction({ id: threadId, apply: true }, project.ctx);

    expect(first).toMatchObject({ action: "apply", threadId, host: HOST, applied: [1, 2] });
    expect(first.action === "apply" && first.conflicts).toEqual([
      expect.objectContaining({ seq: 3, path: "title", current: "Late" }),
    ]);
    expect((await getStory({ id: "ROW-01" }, project.ctx)).title).toBe("Late");
    expect((await listAttachments({ story: "ROW-01" }, project.ctx)).map((entry) => entry.id)).toEqual([ATTACHMENT.id]);
    expect((await readHeldEntries(project.paths, HOST, threadId)).map((entry) => entry.seq)).toEqual([3]);

    const second = await heldAction({ id: threadId, apply: true }, project.ctx);

    expect(second).toMatchObject({ applied: [], conflicts: [expect.objectContaining({ seq: 3 })] });
    expect((await getStory({ id: "ROW-01" }, project.ctx)).title).toBe("Late");
    expect(await listAttachments({ story: "ROW-01" }, project.ctx)).toHaveLength(1);
  });

  it("discards the held folder and does not change the Story", async () => {
    const thread = { id: threadId, host: HOST } as Parameters<typeof hasHeldEntries>[1];
    expect(await hasHeldEntries(project.paths, thread)).toBe(true);

    expect(await heldAction({ id: threadId, discard: true }, project.ctx)).toEqual({
      action: "discard",
      threadId,
      host: HOST,
      discarded: 3,
    });

    await expect(stat(join(project.paths.runtimeDir, "hosts", HOST, "held", threadId))).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(await hasHeldEntries(project.paths, thread)).toBe(false);
    expect((await getStory({ id: "ROW-01" }, project.ctx)).title).toBe("First");
    expect(await listAttachments({ story: "ROW-01" }, project.ctx)).toEqual([]);
  });

  it("refuses --apply with --discard, and gives no entries for a local Thread", async () => {
    await expect(heldAction({ id: threadId, apply: true, discard: true }, project.ctx)).rejects.toMatchObject({
      code: "VALIDATION",
    });

    const local = await abandonedThread("local");
    expect(await heldAction({ id: local }, project.ctx)).toEqual({
      action: "list",
      threadId: local,
      host: null,
      entries: [],
    });
  });
});
