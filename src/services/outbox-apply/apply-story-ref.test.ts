import { createHash } from "node:crypto";
import { rename } from "node:fs/promises";
import { beforeEach, describe, expect, it } from "vitest";
import { listAttachments } from "../attachment/attachment.js";
import type { EntryBody } from "../outbox/outbox.js";
import {
  acknowledgeOutbox,
  appendOutboxEntry,
  readOutboxBlob,
  readOutboxEntries,
  writeOutboxBlob,
} from "../outbox/outbox-file.js";
import { createStory, getStory, type Story } from "../story/story.js";
import { createFakeHostTransport } from "../test-project/fake-host-transport.js";
import { useTempDir, useTestProject } from "../test-project/test-project.js";
import { syncOutbox } from "./outbox-apply.js";
import { type OutboxSource, transportOutboxSource } from "./outbox-source.js";

const HOST = "mini";
const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const ID_1 = `a${"1".repeat(36)}`;
const UNKNOWN_UID = "99999999-9999-4999-8999-999999999999";
const record = (id: string) => ({
  id,
  name: "shot.png",
  type: "image/png",
  size: PNG.length,
  createdAt: "2026-11-16T10:00:00.000Z",
});

describe("outbox apply with the Story uid", () => {
  const project = useTestProject();
  const outbox = useTempDir();
  let first: Story;

  /** A fake host that answers from the outbox folder. */
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
        return { exitCode: 0, value: await acknowledgeOutbox(outbox.path, request.seq ?? 0), stderr: "" };
      },
      bytes: async (command) => ({
        exitCode: 0,
        bytes: await readOutboxBlob({ dir: outbox.path, sha256: command[3] as string }),
        stderr: "",
      }),
    });
    return transportOutboxSource({ transport, rowbly: "/opt/rowbly/bin/rowbly" });
  }

  const append = (body: EntryBody) => appendOutboxEntry({ dir: outbox.path, threadId: "thread-1" }, body);
  const sync = () => syncOutbox({ host: HOST, source: source() }, project.ctx);

  /** Gives the Story file of ROW-01 the number 7, as a re-number does. */
  const renumberFirst = () =>
    rename(project.path("stories/BACKLOG/ROW-01.md"), project.path("stories/BACKLOG/ROW-07.md"));

  beforeEach(async () => {
    first = await createStory({ title: "First" }, project.ctx);
    await createStory({ title: "Second" }, project.ctx);
  });

  it("applies a field entry to the Story with its storyUid after the Story gets a new number", async () => {
    await append({
      storyId: "ROW-01",
      storyUid: first.uid,
      changes: [{ path: "title", before: "First", after: "Renamed" }],
    });
    await renumberFirst();

    const result = await sync();

    expect(result).toMatchObject({ appliedSeq: 1, conflicts: [] });
    expect(await getStory({ id: "ROW-07" }, project.ctx)).toMatchObject({ title: "Renamed", uid: first.uid });
  });

  it("applies an attachment entry to the Story with its storyUid after the Story gets a new number", async () => {
    await writeOutboxBlob(outbox.path, PNG);
    await append({
      storyId: "ROW-01",
      storyUid: first.uid,
      type: "attachment.add",
      attachment: { ...record(ID_1), storyUid: first.uid },
      sha256: sha(PNG),
    });
    await renumberFirst();

    const result = await sync();

    expect(result.conflicts).toEqual([]);
    expect(await listAttachments({ story: "ROW-07" }, project.ctx)).toMatchObject([{ id: ID_1, storyUid: first.uid }]);
  });

  it("applies an entry without a storyUid from an older build by the Story ID, as before", async () => {
    await append({ storyId: "ROW-02", changes: [{ path: "title", before: "Second", after: "Renamed" }] });
    await writeOutboxBlob(outbox.path, PNG);
    await append({ storyId: "ROW-02", type: "attachment.add", attachment: record(ID_1), sha256: sha(PNG) });

    const result = await sync();

    expect(result).toMatchObject({ appliedSeq: 2, applied: [1, 2], conflicts: [] });
    expect(await getStory({ id: "ROW-02" }, project.ctx)).toMatchObject({ title: "Renamed" });
    expect(await listAttachments({ story: "ROW-02" }, project.ctx)).toMatchObject([{ id: ID_1 }]);
  });

  it("applies an entry with a storyUid that no Story has by the Story ID", async () => {
    await append({
      storyId: "ROW-02",
      storyUid: UNKNOWN_UID,
      changes: [{ path: "title", before: "Second", after: "Renamed" }],
    });

    const result = await sync();

    expect(result.conflicts).toEqual([]);
    expect(await getStory({ id: "ROW-02" }, project.ctx)).toMatchObject({ title: "Renamed" });
  });

  it("gives a conflict for an entry with a storyUid that is not a string, and continues", async () => {
    await append({
      storyId: "ROW-02",
      storyUid: 7,
      changes: [{ path: "title", before: "Second", after: "Bad" }],
    } as unknown as EntryBody);
    await append({ storyId: "ROW-02", changes: [{ path: "title", before: "Second", after: "Good" }] });

    const result = await sync();

    expect(result.conflicts.map((conflict) => [conflict.seq, conflict.reason])).toEqual([
      [1, "The entry has an invalid Story uid"],
    ]);
    expect(await getStory({ id: "ROW-02" }, project.ctx)).toMatchObject({ title: "Good" });
  });
});
