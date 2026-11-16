import { createHash } from "node:crypto";
import { appendFile, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { useTempDir } from "../test-project/test-project.js";
import {
  acknowledgeOutbox,
  appendOutboxEntry,
  fileRecorder,
  outboxPaths,
  readOutboxEntries,
  writeOutboxBlob,
} from "./outbox-file.js";
import { hostOutboxAck, hostOutboxEntries } from "./outbox-host.js";

const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
const OTHER = Buffer.from("89504e470d0a1a0a00000000", "hex");
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const attachment = (id: string) => ({
  id,
  name: "shot.png",
  type: "image/png" as const,
  size: 16,
  createdAt: "2026-11-16T10:00:00.000Z",
});
const write = (title: string) => ({ storyId: "ROW-01", changes: [{ path: "title", before: "A", after: title }] });

describe("readOutboxEntries", () => {
  const outbox = useTempDir();
  const target = () => ({ dir: outbox.path, threadId: "thread-1" });

  it("gives no entries for a missing outbox", async () => {
    expect(await readOutboxEntries(join(outbox.path, "none"), 0)).toEqual([]);
  });

  it("gives the entries after a seq, in seq order", async () => {
    await appendOutboxEntry(target(), write("B"));
    await appendOutboxEntry(target(), write("C"));
    await appendOutboxEntry(target(), write("D"));

    const entries = await readOutboxEntries(outbox.path, 1);

    expect(entries.map((entry) => entry.seq)).toEqual([2, 3]);
    expect(entries[0]).toMatchObject({ threadId: "thread-1", ...write("C") });
    expect(await readOutboxEntries(outbox.path, 3)).toEqual([]);
  });

  it("ignores a broken last line", async () => {
    await appendOutboxEntry(target(), write("B"));
    await appendFile(outboxPaths(outbox.path).entriesFile, '{"seq":2,"opId":"x","storyId":"RO');

    expect((await readOutboxEntries(outbox.path, 0)).map((entry) => entry.seq)).toEqual([1]);
  });

  it("refuses a seq that is not a whole number of 0 or more", async () => {
    await expect(readOutboxEntries(outbox.path, -1)).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(readOutboxEntries(outbox.path, 1.5)).rejects.toMatchObject({ code: "VALIDATION" });
  });
});

describe("acknowledgeOutbox", () => {
  const outbox = useTempDir();
  const target = () => ({ dir: outbox.path, threadId: "thread-1" });
  const recorder = () => fileRecorder(target());

  it("removes the acknowledged lines and keeps the seq file", async () => {
    await appendOutboxEntry(target(), write("B"));
    await appendOutboxEntry(target(), write("C"));
    await appendOutboxEntry(target(), write("D"));

    expect(await acknowledgeOutbox(outbox.path, 2)).toEqual({ removed: 2, blobs: [] });
    expect((await readOutboxEntries(outbox.path, 0)).map((entry) => entry.seq)).toEqual([3]);
    expect((await readFile(outboxPaths(outbox.path).seqFile, "utf8")).trim()).toBe("3");

    await acknowledgeOutbox(outbox.path, 3);
    expect(await readFile(outboxPaths(outbox.path).entriesFile, "utf8")).toBe("");
    expect((await appendOutboxEntry(target(), write("E"))).seq).toBe(4);
  });

  it("removes a broken line", async () => {
    await appendOutboxEntry(target(), write("B"));
    await appendFile(outboxPaths(outbox.path).entriesFile, '{"seq":2,"op');

    expect(await acknowledgeOutbox(outbox.path, 1)).toEqual({ removed: 2, blobs: [] });
    expect(await readFile(outboxPaths(outbox.path).entriesFile, "utf8")).toBe("");
  });

  it("removes each PNG that no remaining attachment.add entry points to", async () => {
    await recorder().recordAttachmentAdd({
      storyId: "ROW-01",
      attachment: attachment(`a${"1".repeat(36)}`),
      bytes: PNG,
    });
    await recorder().recordAttachmentAdd({
      storyId: "ROW-01",
      attachment: attachment(`a${"2".repeat(36)}`),
      bytes: OTHER,
    });
    await writeOutboxBlob(outbox.path, Buffer.from("89504e470d0a1a0aff", "hex"));
    const blobs = () => readdir(outboxPaths(outbox.path).blobsDir);

    const result = await acknowledgeOutbox(outbox.path, 1);

    expect(result.removed).toBe(1);
    expect(result.blobs.toSorted()).toEqual([sha(PNG), sha(Buffer.from("89504e470d0a1a0aff", "hex"))].toSorted());
    expect(await blobs()).toEqual([`${sha(OTHER)}.png`]);

    await acknowledgeOutbox(outbox.path, 2);
    expect(await blobs()).toEqual([]);
  });

  it("keeps a PNG that a remaining entry also points to", async () => {
    await recorder().recordAttachmentAdd({
      storyId: "ROW-01",
      attachment: attachment(`a${"1".repeat(36)}`),
      bytes: PNG,
    });
    await recorder().recordAttachmentAdd({
      storyId: "ROW-02",
      attachment: attachment(`a${"2".repeat(36)}`),
      bytes: PNG,
    });

    expect(await acknowledgeOutbox(outbox.path, 1)).toEqual({ removed: 1, blobs: [] });
    expect(await readdir(outboxPaths(outbox.path).blobsDir)).toEqual([`${sha(PNG)}.png`]);
  });

  it("works on an empty outbox", async () => {
    expect(await acknowledgeOutbox(outbox.path, 5)).toEqual({ removed: 0, blobs: [] });
  });
});

describe("host outbox requests", () => {
  const outbox = useTempDir();

  it("reads the afterSeq and the seq of the JSON request", async () => {
    await appendOutboxEntry({ dir: outbox.path, threadId: "t" }, write("B"));
    await appendOutboxEntry({ dir: outbox.path, threadId: "t" }, write("C"));

    const answer = await hostOutboxEntries({ dir: outbox.path, text: '{"afterSeq":1}\n' });
    expect(answer.entries.map((entry) => entry.seq)).toEqual([2]);

    expect(await hostOutboxAck({ dir: outbox.path, text: '{"seq":2}' })).toEqual({ removed: 2, blobs: [] });
  });

  it.each([
    ["", "not valid JSON"],
    ["[1]", "JSON object"],
    ['{"afterSeq":"1"}', 'number "afterSeq"'],
  ])("refuses the request %j", async (text, message) => {
    await expect(hostOutboxEntries({ dir: outbox.path, text })).rejects.toMatchObject({
      code: "VALIDATION",
      message: expect.stringContaining(message),
    });
  });

  it("refuses a missing or relative ROWBLY_OUTBOX", async () => {
    await expect(hostOutboxEntries({ dir: undefined, text: '{"afterSeq":0}' })).rejects.toMatchObject({
      code: "VALIDATION",
    });
    await expect(hostOutboxAck({ dir: "relative", text: '{"seq":0}' })).rejects.toMatchObject({ code: "VALIDATION" });
  });
});
