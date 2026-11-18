import type { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { addAttachment, listAttachments } from "../attachment/attachment.js";
import { attachmentDir, MAX_ATTACHMENT_BYTES } from "../attachment-files/attachment-files.js";
import { addCustomField } from "../custom-field/custom-field.js";
import { HostUnreachableError } from "../host-transport/host-errors.js";
import type { EntryBody } from "../outbox/outbox.js";
import {
  acknowledgeOutbox,
  appendOutboxEntry,
  readOutboxBlob,
  readOutboxEntries,
  writeOutboxBlob,
} from "../outbox/outbox-file.js";
import { createStory, getStory, updateStory } from "../story/story.js";
import { addTag } from "../tag/tag.js";
import { createFakeHostTransport } from "../test-project/fake-host-transport.js";
import { useTempDir, useTestProject } from "../test-project/test-project.js";
import { applyOutbox, syncOutbox } from "./outbox-apply.js";
import { type OutboxSource, transportOutboxSource } from "./outbox-source.js";

// Marks the async context that holds each lock, so that a test can see the locks of a Story write.
const locks = vi.hoisted(() => ({
  project: undefined as AsyncLocalStorage<boolean> | undefined,
  state: undefined as AsyncLocalStorage<boolean> | undefined,
  writes: [] as { project: boolean; state: boolean }[],
}));
vi.mock("../project-write/project-write.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../project-write/project-write.js")>();
  const { AsyncLocalStorage: Storage } = await import("node:async_hooks");
  const storage = new Storage<boolean>();
  locks.project = storage;
  return {
    ...actual,
    projectWrite: <T>(root: string, action: () => Promise<T>, waitSeconds?: number) =>
      actual.projectWrite(root, () => storage.run(true, action), waitSeconds),
  };
});
vi.mock("../factory-state/state-file.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../factory-state/state-file.js")>();
  const { AsyncLocalStorage: Storage } = await import("node:async_hooks");
  const storage = new Storage<boolean>();
  locks.state = storage;
  return {
    ...actual,
    withStateLock: <T>(root: string, action: () => Promise<T>) =>
      actual.withStateLock(root, () => storage.run(true, action)),
  };
});
vi.mock("../story/story.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../story/story.js")>();
  return {
    ...actual,
    updateStory: (...args: Parameters<typeof actual.updateStory>) => {
      locks.writes.push({ project: !!locks.project?.getStore(), state: !!locks.state?.getStore() });
      return actual.updateStory(...args);
    },
  };
});

const HOST = "mini";
const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
const OTHER = Buffer.from("89504e470d0a1a0a00000000", "hex");
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const ID_1 = `a${"1".repeat(36)}`;
const ID_2 = `a${"2".repeat(36)}`;
const record = (id: string, name = "shot.png", type = "image/png", size = 16) => ({
  id,
  name,
  type,
  size,
  createdAt: "2026-11-16T10:00:00.000Z",
});

describe("outbox apply", () => {
  const project = useTestProject();
  const outbox = useTempDir();
  const acks: number[] = [];
  const blobs = new Map<string, Buffer>();

  /** A fake host that answers from the outbox folder. A blob in `blobs` replaces the PNG of the folder. */
  function source(): OutboxSource {
    const transport = createFakeHostTransport({
      request: async (command, input) => {
        const request = input as { afterSeq?: number; seq?: number };
        if (command[2] === "outbox") {
          return {
            exitCode: 0,
            value: { entries: await readOutboxEntries(outbox.path, request.afterSeq ?? 0) },
            stderr: "",
          };
        }
        acks.push(request.seq ?? -1);
        return { exitCode: 0, value: await acknowledgeOutbox(outbox.path, request.seq ?? 0), stderr: "" };
      },
      bytes: async (command) => {
        const hash = command[3] as string;
        const bytes = blobs.get(hash) ?? (await readOutboxBlob({ dir: outbox.path, sha256: hash }));
        return { exitCode: 0, bytes, stderr: "" };
      },
    });
    return transportOutboxSource({ transport, rowbly: "/opt/rowbly/bin/rowbly" });
  }

  const append = (body: EntryBody) => appendOutboxEntry({ dir: outbox.path, threadId: "thread-1" }, body);
  const sync = (from = source()) => syncOutbox({ host: HOST, source: from }, project.ctx);
  const story = (id = "ROW-02") => getStory({ id }, project.ctx);
  const conflictsDir = () => join(project.paths.runtimeDir, "hosts", HOST, "conflicts");
  const appliedFile = () => join(project.paths.runtimeDir, "hosts", HOST, "outbox-applied.json");

  /** Records an `attachment.add` entry with the PNG in the outbox folder. */
  async function appendAdd(storyId: string, id: string, bytes: Buffer, hash = sha(bytes)) {
    await writeOutboxBlob(outbox.path, bytes);
    return append({ storyId, type: "attachment.add", attachment: record(id), sha256: hash });
  }

  beforeEach(async () => {
    acks.length = 0;
    blobs.clear();
    locks.writes.length = 0;
    await addCustomField({ label: "Owner", type: "string" }, project.ctx);
    await addTag({ label: "Bug", value: "bug" }, project.ctx);
    await createStory({ title: "Upstream" }, project.ctx);
    await createStory({ title: "First", description: "old" }, project.ctx);
  });

  it("applies a field entry for each path where the value is equal to before", async () => {
    const changes = [
      { path: "title", before: "First", after: "Renamed" },
      { path: "description", before: "old", after: "new" },
      { path: "stage", before: "BACKLOG", after: "DONE" },
      { path: "fields.owner", before: null, after: "sam" },
      { path: "tags", before: [], after: ["bug"] },
      { path: "dependsOn", before: [], after: ["ROW-01"] },
    ];
    for (const change of changes) {
      await append({ storyId: "ROW-02", changes: [change] });
    }

    const result = await sync();

    expect(result).toMatchObject({ appliedSeq: 6, applied: [1, 2, 3, 4, 5, 6], conflicts: [] });
    expect(await story()).toMatchObject({
      title: "Renamed",
      description: "new",
      stage: "DONE",
      fields: { owner: "sam" },
      tags: ["bug"],
      dependsOn: ["ROW-01"],
    });
    expect(JSON.parse(await readFile(appliedFile(), "utf8"))).toEqual({ seq: 6 });
    expect(acks).toEqual([6]);
    expect(await readOutboxEntries(outbox.path, 0)).toEqual([]);
  });

  it("writes nothing and gives no conflict for a value that is already equal to after", async () => {
    await updateStory({ id: "ROW-02", title: "Renamed" }, project.ctx);
    const before = await stat((await story()).path);
    await append({ storyId: "ROW-02", changes: [{ path: "title", before: "First", after: "Renamed" }] });
    locks.writes.length = 0;

    const result = await sync();

    expect(result.conflicts).toEqual([]);
    expect(locks.writes).toEqual([]);
    expect((await stat((await story()).path)).mtimeMs).toBe(before.mtimeMs);
  });

  it("keeps a third value, gives one conflict and writes the changes that do not conflict", async () => {
    await updateStory({ id: "ROW-02", title: "Local" }, project.ctx);
    await append({
      storyId: "ROW-02",
      changes: [
        { path: "title", before: "First", after: "Remote" },
        { path: "fields.owner", before: null, after: "sam" },
      ],
    });

    const result = await sync();

    expect(result.conflicts).toEqual([
      {
        host: HOST,
        seq: 1,
        storyId: "ROW-02",
        path: "title",
        before: "First",
        after: "Remote",
        current: "Local",
        reason: "The value on the main machine is different",
      },
    ]);
    expect(await story()).toMatchObject({ title: "Local", fields: { owner: "sam" } });
    expect(result.appliedSeq).toBe(1);
  });

  it("gives a conflict for each change of a Story that does not exist", async () => {
    await append({
      storyId: "ROW-09",
      changes: [
        { path: "title", before: "A", after: "B" },
        { path: "stage", before: "BACKLOG", after: "DONE" },
      ],
    });

    const result = await sync();

    expect(result.conflicts.map((conflict) => [conflict.path, conflict.reason])).toEqual([
      ["title", "The Story does not exist"],
      ["stage", "The Story does not exist"],
    ]);
  });

  it("gives a conflict for an unknown path, a bad value, an unknown type and a bad shape, and continues", async () => {
    await append({ storyId: "ROW-02", changes: [{ path: "updatedAt", before: null, after: "x" }] });
    await append({ storyId: "ROW-02", changes: [{ path: "stage", before: "BACKLOG", after: "NOPE" }] });
    await append({ storyId: "ROW-02", type: "attachment.move" } as unknown as EntryBody);
    await append({ storyId: "ROW-02" } as unknown as EntryBody);
    await append({ storyId: "ROW-02", changes: [{ path: "title", before: "First", after: "Last" }] });

    const result = await sync();

    expect(result.conflicts.map((conflict) => [conflict.seq, conflict.reason])).toEqual([
      [1, "Unknown path updatedAt"],
      [2, "The story is invalid"],
      [3, "Unknown entry type: attachment.move"],
      [4, "The entry has no valid list of changes"],
    ]);
    expect(await story()).toMatchObject({ title: "Last", stage: "BACKLOG" });
    expect(result.appliedSeq).toBe(5);
  });

  it("adds a good PNG with the id and the name of the entry", async () => {
    await appendAdd("ROW-02", ID_1, PNG);

    const result = await sync();

    expect(result.conflicts).toEqual([]);
    expect(await listAttachments({ story: "ROW-02" }, project.ctx)).toMatchObject([{ id: ID_1, name: "shot.png" }]);
    const dir = await attachmentDir(project.paths, "ROW-02");
    expect((await readFile(join(dir, `${ID_1}.png`))).equals(PNG)).toBe(true);
    expect(await readdir(join(outbox.path, "blobs"))).toEqual([]);
  });

  it("adds a file that is not a PNG with the same bytes, name and type", async () => {
    const pdf = Buffer.from("%PDF-1.7\nreport\n");
    await writeOutboxBlob(outbox.path, pdf);
    await append({
      storyId: "ROW-02",
      type: "attachment.add",
      attachment: record(ID_1, "report.pdf", "application/pdf", pdf.length),
      sha256: sha(pdf),
    });

    const result = await sync();

    expect(result.conflicts).toEqual([]);
    expect(await listAttachments({ story: "ROW-02" }, project.ctx)).toMatchObject([
      { id: ID_1, name: "report.pdf", type: "application/pdf", size: pdf.length },
    ]);
    const dir = await attachmentDir(project.paths, "ROW-02");
    expect((await readFile(join(dir, `${ID_1}.pdf`))).equals(pdf)).toBe(true);

    await appendAdd("ROW-02", ID_1, pdf);

    expect((await sync()).conflicts).toEqual([]);
  });

  const large = Buffer.concat([PNG, Buffer.alloc(MAX_ATTACHMENT_BYTES + 1 - PNG.length)]);

  it.each([
    ["a hash that is not equal", OTHER, sha(PNG), "The file does not have the sha256 of the entry"],
    ["more than 10 MiB", large, sha(large), "The file is larger than 10 MiB"],
  ])("gives a conflict for %s and keeps the file", async (_name, bytes, hash, reason) => {
    blobs.set(hash, bytes);
    await append({ storyId: "ROW-02", type: "attachment.add", attachment: record(ID_1), sha256: hash });

    const result = await sync();

    expect(result.conflicts).toEqual([
      expect.objectContaining({ seq: 1, storyId: "ROW-02", attachmentId: ID_1, reason }),
    ]);
    expect(await listAttachments({ story: "ROW-02" }, project.ctx)).toEqual([]);
    const kept = join(conflictsDir(), `${sha(bytes)}.png`);
    expect(result.conflicts[0]?.png).toBe(kept);
    expect((await readFile(kept)).equals(bytes)).toBe(true);
    expect((await stat(conflictsDir())).mode & 0o777).toBe(0o700);
  });

  it("gives a conflict for a Story that does not exist and keeps the PNG", async () => {
    await appendAdd("ROW-09", ID_1, PNG);

    const result = await sync();

    expect(result.conflicts).toEqual([expect.objectContaining({ reason: "The Story does not exist" })]);
    expect((await readFile(join(conflictsDir(), `${sha(PNG)}.png`))).equals(PNG)).toBe(true);
  });

  it("skips an id with the same hash, and gives a conflict for an id with a different hash", async () => {
    await addAttachment({ story: "ROW-02", image: { name: "local.png", bytes: PNG }, id: ID_1 }, project.ctx);
    await addAttachment({ story: "ROW-02", image: { name: "local.png", bytes: PNG }, id: ID_2 }, project.ctx);
    await appendAdd("ROW-02", ID_1, PNG);
    await appendAdd("ROW-02", ID_2, OTHER);

    const result = await sync();

    expect(result.conflicts).toEqual([
      expect.objectContaining({ seq: 2, attachmentId: ID_2, reason: expect.stringContaining("different file") }),
    ]);
    expect((await listAttachments({ story: "ROW-02" }, project.ctx)).map((a) => a.name)).toEqual([
      "local.png",
      "local.png",
    ]);
  });

  it("removes an attachment that is there and skips one that is not there", async () => {
    await addAttachment({ story: "ROW-02", image: { name: "local.png", bytes: PNG }, id: ID_1 }, project.ctx);
    await append({ storyId: "ROW-02", type: "attachment.remove", id: ID_1, sha256: sha(PNG) });
    await append({ storyId: "ROW-02", type: "attachment.remove", id: ID_2, sha256: sha(PNG) });
    await append({ storyId: "ROW-09", type: "attachment.remove", id: ID_2, sha256: sha(PNG) });

    const result = await sync();

    expect(result).toMatchObject({ appliedSeq: 3, conflicts: [] });
    expect(await listAttachments({ story: "ROW-02" }, project.ctx)).toEqual([]);
  });

  it("gives the same entries two times with one effect", async () => {
    await append({ storyId: "ROW-02", changes: [{ path: "tags", before: [], after: ["bug"] }] });
    await appendAdd("ROW-02", ID_1, PNG);
    const entries = await readOutboxEntries(outbox.path, 0);
    const from = source();

    const first = await applyOutbox({ host: HOST, entries, source: from }, project.ctx);
    const second = await applyOutbox({ host: HOST, entries: [...entries, ...entries], source: from }, project.ctx);

    expect(first).toMatchObject({ appliedSeq: 2, applied: [1, 2], conflicts: [] });
    expect(second).toEqual({ appliedSeq: 2, applied: [], conflicts: [] });
    expect(await listAttachments({ story: "ROW-02" }, project.ctx)).toHaveLength(1);
    expect(locks.writes).toHaveLength(1);
  });

  it("applies no entry two times after a crash before the acknowledgement, then sends it", async () => {
    await append({ storyId: "ROW-02", changes: [{ path: "title", before: "First", after: "Renamed" }] });
    const host = source();
    const crashing: OutboxSource = {
      ...host,
      acknowledge: () => Promise.reject(new Error("crash")),
    };

    await expect(sync(crashing)).rejects.toThrow("crash");
    expect(await readOutboxEntries(outbox.path, 0)).toHaveLength(1);
    await updateStory({ id: "ROW-02", title: "Local" }, project.ctx);
    locks.writes.length = 0;

    const second = await sync(host);

    expect(second).toEqual({ appliedSeq: 1, applied: [], conflicts: [] });
    expect(locks.writes).toEqual([]);
    expect((await story()).title).toBe("Local");
    expect(acks).toEqual([1]);
    expect(await readOutboxEntries(outbox.path, 0)).toEqual([]);
  });

  it("gives the problem of a failed acknowledgement with the result", async () => {
    await append({ storyId: "ROW-02", changes: [{ path: "title", before: "First", after: "Renamed" }] });
    const failing: OutboxSource = {
      ...source(),
      acknowledge: () => Promise.reject(new HostUnreachableError("Cannot reach mini")),
    };

    expect(await sync(failing)).toMatchObject({ appliedSeq: 1, acknowledgeProblem: "Cannot reach mini" });
  });

  it("stops without a record when the host is unreachable during a blob fetch", async () => {
    await appendAdd("ROW-02", ID_1, PNG);
    const failing: OutboxSource = {
      ...source(),
      blob: () => Promise.reject(new HostUnreachableError("Cannot reach mini")),
    };

    await expect(sync(failing)).rejects.toThrow("Cannot reach mini");
    await expect(stat(appliedFile())).rejects.toMatchObject({ code: "ENOENT" });
    expect((await sync()).conflicts).toEqual([]);
    expect(await listAttachments({ story: "ROW-02" }, project.ctx)).toHaveLength(1);
  });

  it("holds the Project write lock and not the state lock during each Story write", async () => {
    await append({ storyId: "ROW-02", changes: [{ path: "title", before: "First", after: "Renamed" }] });

    await sync();

    expect(locks.writes).toEqual([{ project: true, state: false }]);
  });
});
