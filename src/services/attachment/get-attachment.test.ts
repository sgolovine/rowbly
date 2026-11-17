import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { putCachedAttachment } from "../attachment-cache/attachment-cache.js";
import type { RemoteAttachmentSource } from "../attachment-cache/attachment-source.js";
import type { HostWorkRunner } from "../host-agent/host-agent-work.js";
import { hostAttachmentSource } from "../host-agent/host-attachment-source.js";
import { ensureLink } from "../remote-executor/remote-channel.js";
import type { RemoteEnv, RemoteState } from "../remote-executor/remote-types.js";
import { Store } from "../store/store.js";
import { createStory } from "../story/story.js";
import { createFakeHostAgent } from "../test-project/fake-host-agent.js";
import { useTempDir, useTestProject } from "../test-project/test-project.js";
import { addAttachment, getAttachment } from "./attachment.js";

const runner: HostWorkRunner = {
  start: async () => {
    throw new Error("The test starts no work");
  },
};

const hooks = { sync: async () => undefined, stopHost: async () => undefined };

describe("getAttachment", () => {
  const main = useTestProject();
  const copy = useTestProject();
  const home = useTempDir();

  /** Adds an attachment on the main machine, and puts the Story and the manifest, without the file, in the copy. */
  async function setUp() {
    await createStory({ title: "Story" }, main.ctx);
    await createStory({ title: "Story" }, copy.ctx);
    const file = join(main.paths.root, "notes.txt");
    await writeFile(file, "the notes of the main machine");
    const record = await addAttachment({ story: "ROW-01", file }, main.ctx);
    await copy.write("attachments/ROW-01/manifest.json", await main.read("attachments/ROW-01/manifest.json"));
    return { record, copyFile: copy.path(`attachments/ROW-01/${record.id}.txt`) };
  }

  const failingSource: RemoteAttachmentSource = {
    fetch: async () => {
      throw new Error("The test expects no fetch");
    },
  };

  it("gives the record and the absolute path on the main machine, and NOT_FOUND for an unknown Story or id", async () => {
    const { record } = await setUp();

    expect(await getAttachment({ story: "ROW-01", id: record.id }, main.ctx)).toEqual({
      ...record,
      path: main.path(`attachments/ROW-01/${record.id}.txt`),
    });
    await expect(getAttachment({ story: "ROW-99", id: record.id }, main.ctx)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(
      getAttachment({ story: "ROW-01", id: "a00000000-0000-4000-8000-000000000009" }, main.ctx),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(getAttachment({ story: "ROW-01", id: "../x" }, main.ctx)).rejects.toMatchObject({
      code: "VALIDATION",
    });
  });

  it("gives NOT_FOUND for a missing file without an attachment source", async () => {
    const { record } = await setUp();

    await expect(getAttachment({ story: "ROW-01", id: record.id }, copy.ctx)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("gives the path in the copy when the copy has the file, and fetches nothing", async () => {
    const { record, copyFile } = await setUp();
    await writeFile(copyFile, "the notes of the main machine");

    const ctx = { ...copy.ctx, remoteAttachments: failingSource };
    expect(await getAttachment({ story: "ROW-01", id: record.id }, ctx)).toMatchObject({ path: copyFile });
  });

  it("copies the file of the host cache into the copy, and writes no fetch request", async () => {
    const { record, copyFile } = await setUp();
    const agent = createFakeHostAgent({ projectId: "p1", home: home.path, runner });
    const source = hostAttachmentSource({ paths: agent.paths });
    const bytes = Buffer.from("the notes of the main machine");
    await putCachedAttachment({ dir: agent.paths.attachments, id: record.id, bytes });

    const result = await getAttachment({ story: "ROW-01", id: record.id }, { ...copy.ctx, remoteAttachments: source });

    expect(result.path).toBe(copyFile);
    expect(await readFile(copyFile)).toEqual(bytes);
    expect(await readdir(agent.paths.fetch).catch(() => [])).toEqual([]);
  });

  it("refuses a fetched file with a different size, and writes no file", async () => {
    const { record, copyFile } = await setUp();
    const source: RemoteAttachmentSource = { fetch: async () => Buffer.from("short") };

    await expect(
      getAttachment({ story: "ROW-01", id: record.id }, { ...copy.ctx, remoteAttachments: source }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(readFile(copyFile)).rejects.toMatchObject({ code: "ENOENT" });
  });

  describe("through the attach channel", () => {
    async function connect() {
      const agent = createFakeHostAgent({ projectId: "p1", home: home.path, runner, pollMs: 10 });
      const env: RemoteEnv = {
        input: { projectId: "p1", paths: main.paths, ctx: main.ctx } as unknown as RemoteEnv["input"],
        state: new Store<RemoteState>({
          runs: new Map(),
          links: new Map(),
          queueChain: Promise.resolve(),
          reconnects: new Map(),
          outcomes: new Map(),
        }),
      };
      await ensureLink(env, "mini", { transport: agent.transport, rowbly: "/r/rowbly", clone: "repo" }, hooks);
      await vi.waitFor(async () => expect(await readFile(agent.paths.channel, "utf8")).toContain("token"));
      return agent;
    }

    it("gets a file from the main machine with cache-put, and puts it in the cache and in the copy", async () => {
      const { record, copyFile } = await setUp();
      const agent = await connect();
      const source = hostAttachmentSource({ paths: agent.paths, pollMs: 10 });

      try {
        const result = await getAttachment(
          { story: "ROW-01", id: record.id },
          { ...copy.ctx, remoteAttachments: source },
        );

        const canonical = await readFile(main.path(`attachments/ROW-01/${record.id}.txt`));
        expect(result.path).toBe(copyFile);
        expect(await readFile(copyFile)).toEqual(canonical);
        expect(await readFile(join(agent.paths.attachments, `${record.id}.png`))).toEqual(canonical);
        expect(agent.transport.uploads.map((upload) => upload.command)).toEqual([
          ["/r/rowbly", "host", "cache-put", "p1", record.id],
        ]);
        expect(await readdir(agent.paths.fetch)).toEqual([]);
      } finally {
        await agent.stop();
      }
    });

    it("fails with CONFLICT and the reason of the main machine before the time limit", async () => {
      const { record } = await setUp();
      await mkdir(main.path("attachments/ROW-01"), { recursive: true });
      await writeFile(main.path("attachments/ROW-01/manifest.json"), "[]");
      const agent = await connect();
      const source = hostAttachmentSource({ paths: agent.paths, pollMs: 10, timeoutMs: 60_000 });
      const started = Date.now();

      try {
        await expect(
          getAttachment({ story: "ROW-01", id: record.id }, { ...copy.ctx, remoteAttachments: source }),
        ).rejects.toMatchObject({
          code: "CONFLICT",
          message: expect.stringContaining(`Attachment ${record.id} not found on ROW-01`),
        });
        expect(Date.now() - started).toBeLessThan(10_000);
        expect(agent.transport.uploads).toEqual([]);
      } finally {
        await agent.stop();
      }
    });

    it("fails at once with CONFLICT when the host has no live channel", async () => {
      const { record } = await setUp();
      const agent = createFakeHostAgent({ projectId: "p1", home: home.path, runner });
      const source = hostAttachmentSource({ paths: agent.paths, timeoutMs: 60_000 });

      await expect(
        getAttachment({ story: "ROW-01", id: record.id }, { ...copy.ctx, remoteAttachments: source }),
      ).rejects.toMatchObject({ code: "CONFLICT", message: expect.stringContaining("The worker host is offline") });
      expect(await readdir(agent.paths.fetch).catch(() => [])).toEqual([]);
    });
  });
});
