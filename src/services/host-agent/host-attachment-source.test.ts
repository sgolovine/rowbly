import { readdir } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { putCachedAttachment } from "../attachment-cache/attachment-cache.js";
import { newOwner } from "../factory-ownership/ownership-lock.js";
import { useTempDir } from "../test-project/test-project.js";
import { hostAgentPaths } from "./host-agent-paths.js";
import { hostAttachmentSource } from "./host-attachment-source.js";
import { writeChannelMark } from "./host-channel-mark.js";
import { readFetchRequests, writeFetchFailure } from "./host-fetch.js";

const ID = "a00000000-0000-4000-8000-000000000001";
const BYTES = Buffer.from("attachment bytes");
const alive = async () => "alive" as const;

describe("host attachment source", () => {
  const home = useTempDir();
  const paths = () => hostAgentPaths("p1", home.path);
  const source = (timeoutMs = 5000) => hostAttachmentSource({ paths: paths(), probe: alive, timeoutMs, pollMs: 10 });
  const fetchDir = () => readdir(paths().fetch).catch(() => []);

  it("gives the bytes of the cache, and writes no fetch request", async () => {
    await putCachedAttachment({ dir: paths().attachments, id: ID, bytes: BYTES });
    expect(Buffer.from(await source().fetch({ storyId: "ROW-1", id: ID }))).toEqual(BYTES);
    expect(await fetchDir()).toEqual([]);
  });

  it("fails at once with CONFLICT when no channel is live", async () => {
    const started = Date.now();
    await expect(source(60_000).fetch({ storyId: "ROW-1", id: ID })).rejects.toMatchObject({
      code: "CONFLICT",
      message: expect.stringContaining("The worker host is offline"),
    });
    expect(Date.now() - started).toBeLessThan(5000);
    expect(await fetchDir()).toEqual([]);

    await writeChannelMark(paths(), await newOwner());
    const dead = hostAttachmentSource({ paths: paths(), probe: async () => "dead", pollMs: 10 });
    await expect(dead.fetch({ storyId: "ROW-1", id: ID })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await fetchDir()).toEqual([]);
  });

  it("fails with CONFLICT after the time limit when no answer arrives, and removes its request", async () => {
    await writeChannelMark(paths(), await newOwner());
    const started = Date.now();
    await expect(source(100).fetch({ storyId: "ROW-1", id: ID })).rejects.toMatchObject({
      code: "CONFLICT",
      message: expect.stringMatching(/offline.*did not send the file in 100 ms/),
    });
    expect(Date.now() - started).toBeGreaterThanOrEqual(100);
    expect(await readFetchRequests(paths())).toEqual([]);
  });

  it("gives the file that arrives in the cache during the wait", async () => {
    await writeChannelMark(paths(), await newOwner());
    const read = source().fetch({ storyId: "ROW-1", id: ID });
    await expect.poll(() => readFetchRequests(paths())).toHaveLength(1);
    await putCachedAttachment({ dir: paths().attachments, id: ID, bytes: BYTES });
    expect(Buffer.from(await read)).toEqual(BYTES);
    expect(await fetchDir()).toEqual([]);
  });

  it("fails with CONFLICT and the reason of the main machine at a failure answer", async () => {
    await writeChannelMark(paths(), await newOwner());
    const started = Date.now();
    const read = source(60_000).fetch({ storyId: "ROW-1", id: ID });
    await expect.poll(() => readFetchRequests(paths())).toHaveLength(1);
    await writeFetchFailure(paths(), ID, "Attachment not found on ROW-1");
    await expect(read).rejects.toMatchObject({
      code: "CONFLICT",
      message: expect.stringContaining("Attachment not found on ROW-1"),
    });
    expect(Date.now() - started).toBeLessThan(5000);
    expect(await fetchDir()).toEqual([]);
  });

  it("refuses a bad id or Story id with VALIDATION before it writes", async () => {
    await writeChannelMark(paths(), await newOwner());
    for (const request of [
      { storyId: "ROW-1", id: "../x" },
      { storyId: "../x", id: ID },
    ]) {
      await expect(source().fetch(request)).rejects.toMatchObject({ code: "VALIDATION" });
    }
    expect(await fetchDir()).toEqual([]);
  });
});
