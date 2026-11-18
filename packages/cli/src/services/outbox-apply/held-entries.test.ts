import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { listAttachments } from "../attachment/attachment.js";
import { HostUnreachableError } from "../host-transport/host-errors.js";
import { createStory, getStory } from "../story/story.js";
import { useTestProject } from "../test-project/test-project.js";
import { readHeldBlob, readHeldEntries } from "./held-entries.js";
import { readAppliedSeq } from "./host-files.js";
import { applyOutbox } from "./outbox-apply.js";

const HOST = "mini";
const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const ATTACHMENT = {
  id: `a${"1".repeat(36)}`,
  name: "shot.png",
  type: "image/png",
  size: 16,
  createdAt: "2026-11-16T10:00:00.000Z",
};

function field(seq: number, threadId: string, storyId: string, after: string) {
  return { seq, opId: `op-${seq}`, threadId, storyId, changes: [{ path: "title", before: "First", after }] };
}

function add(seq: number, threadId: string, storyId: string, hash = sha(PNG)) {
  return { seq, opId: `op-${seq}`, threadId, storyId, type: "attachment.add", attachment: ATTACHMENT, sha256: hash };
}

describe("held entries of abandoned Threads", () => {
  const project = useTestProject();
  const heldDir = (threadId: string) => join(project.paths.runtimeDir, "hosts", HOST, "held", threadId);
  const source = { blob: async (hash: string) => (hash === sha(PNG) ? PNG : Buffer.from("bad")) };

  beforeEach(async () => {
    await createStory({ title: "First" }, project.ctx);
    await createStory({ title: "First" }, project.ctx);
  });

  it("holds the later entries of an abandoned Thread and applies the entries of the other Threads", async () => {
    const entries = [field(1, "gone", "ROW-01", "Early"), field(2, "gone", "ROW-01", "Late"), add(3, "gone", "ROW-01")];
    const other = field(4, "live", "ROW-02", "Applied");

    const result = await applyOutbox(
      { host: HOST, entries: [...entries, other], source, abandoned: [{ threadId: "gone", appliedSeq: 1 }] },
      project.ctx,
    );

    expect(result).toMatchObject({
      appliedSeq: 4,
      applied: [1, 2, 3, 4],
      conflicts: [],
      held: [
        { threadId: "gone", seq: 2 },
        { threadId: "gone", seq: 3 },
      ],
    });
    // Seq 1 is not after the appliedSeq of the note, so the apply applied it.
    expect((await getStory({ id: "ROW-01" }, project.ctx)).title).toBe("Early");
    expect(await listAttachments({ story: "ROW-01" }, project.ctx)).toEqual([]);
    expect((await getStory({ id: "ROW-02" }, project.ctx)).title).toBe("Applied");
    expect(await readAppliedSeq(project.paths, HOST)).toBe(4);

    const held = await readHeldEntries(project.paths, HOST, "gone");
    expect(held.map((entry) => entry.seq)).toEqual([2, 3]);
    expect(Buffer.from(await readHeldBlob(project.paths, HOST, "gone", sha(PNG)))).toEqual(PNG);
    expect((await stat(heldDir("gone"))).mode & 0o777).toBe(0o700);
    expect((await stat(join(heldDir("gone"), "entries.jsonl"))).mode & 0o777).toBe(0o600);
    expect((await stat(join(heldDir("gone"), "blobs", `${sha(PNG)}.png`))).mode & 0o777).toBe(0o600);
  });

  it("holds an entry one time, also when it arrives again", async () => {
    const abandoned = [{ threadId: "gone", appliedSeq: 0 }];
    await applyOutbox({ host: HOST, entries: [field(1, "gone", "ROW-01", "Late")], source, abandoned }, project.ctx);
    const again = await applyOutbox(
      { host: HOST, entries: [field(1, "gone", "ROW-01", "Late")], source, abandoned },
      project.ctx,
    );

    expect(again).toEqual({ appliedSeq: 1, applied: [], conflicts: [] });
    expect(await readHeldEntries(project.paths, HOST, "gone")).toHaveLength(1);
    expect((await readFile(join(heldDir("gone"), "entries.jsonl"), "utf8")).trim().split("\n")).toHaveLength(1);
  });

  it("keeps an entry with a bad file held without the file", async () => {
    const abandoned = [{ threadId: "gone", appliedSeq: 0 }];
    const hash = sha(Buffer.from("other"));

    await applyOutbox({ host: HOST, entries: [add(1, "gone", "ROW-01", hash)], source, abandoned }, project.ctx);

    expect(await readHeldEntries(project.paths, HOST, "gone")).toHaveLength(1);
    await expect(readHeldBlob(project.paths, HOST, "gone", hash)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("stops before the seq record when the file cannot come from the host", async () => {
    const abandoned = [{ threadId: "gone", appliedSeq: 0 }];
    const offline = {
      blob: async () => {
        throw new HostUnreachableError("Cannot reach mini");
      },
    };

    await expect(
      applyOutbox({ host: HOST, entries: [add(1, "gone", "ROW-01")], source: offline, abandoned }, project.ctx),
    ).rejects.toBeInstanceOf(HostUnreachableError);
    expect(await readAppliedSeq(project.paths, HOST)).toBe(0);
    expect(await readHeldEntries(project.paths, HOST, "gone")).toEqual([]);
  });
});
