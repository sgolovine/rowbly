import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { addAttachment } from "../attachment/attachment.js";
import { helloFrame } from "../host-transport/host-transport.js";
import { Store } from "../store/store.js";
import { createStory } from "../story/story.js";
import { createFakeHostTransport, type FakeRemoteChannel } from "../test-project/fake-host-transport.js";
import { useTestProject } from "../test-project/test-project.js";
import { ensureLink } from "./remote-channel.js";
import type { RemoteEnv, RemoteState } from "./remote-types.js";

const hooks = { sync: async () => undefined, stopHost: async () => undefined };

describe("remote attachment requests", () => {
  const project = useTestProject();

  async function open(uploadExit = 0) {
    const remotes: FakeRemoteChannel[] = [];
    const transport = createFakeHostTransport({
      upload: () => ({ exitCode: uploadExit, stderr: uploadExit ? "disk full" : "" }),
      channel: (_command, remote) => {
        remotes.push(remote);
        remote.send(helloFrame());
        return undefined;
      },
    });
    const env: RemoteEnv = {
      input: { projectId: "p1", paths: project.paths, ctx: project.ctx } as unknown as RemoteEnv["input"],
      state: new Store<RemoteState>({
        runs: new Map(),
        links: new Map(),
        queueChain: Promise.resolve(),
        reconnects: new Map(),
        outcomes: new Map(),
      }),
    };
    await ensureLink(env, "mini", { transport, rowbly: "/r/rowbly", clone: "repo" }, hooks);
    const remote = remotes[0] as FakeRemoteChannel;
    return { transport, remote };
  }

  async function attachment() {
    await createStory({ title: "Story" }, project.ctx);
    const file = join(project.paths.root, "notes.txt");
    await writeFile(file, "the notes");
    return addAttachment({ story: "ROW-01", file }, project.ctx);
  }

  it("uploads the file of an existing attachment with one cache-put", async () => {
    const record = await attachment();
    const { transport, remote } = await open();

    remote.send({ type: "attachment-request", storyId: "ROW-01", id: record.id });
    await vi.waitFor(() => expect(transport.uploads).toHaveLength(1));

    expect(transport.uploads[0]?.command).toEqual(["/r/rowbly", "host", "cache-put", "p1", record.id]);
    expect(transport.uploads[0]?.data.toString()).toBe("the notes");
    expect(remote.received).toEqual([]);
  });

  it("gives one upload at a time for one request id", async () => {
    const record = await attachment();
    const { transport, remote } = await open();

    remote.send({ type: "attachment-request", storyId: "ROW-01", id: record.id });
    remote.send({ type: "attachment-request", storyId: "ROW-01", id: record.id });
    await vi.waitFor(() => expect(transport.uploads).toHaveLength(1));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(transport.uploads).toHaveLength(1);
  });

  it("sends attachment-failed and no upload for an unknown Story, an unknown id or a bad id", async () => {
    const record = await attachment();
    const { transport, remote } = await open();
    const unknownId = "a00000000-0000-4000-8000-000000000009";

    remote.send({ type: "attachment-request", storyId: "ROW-99", id: record.id });
    remote.send({ type: "attachment-request", storyId: "ROW-01", id: unknownId });
    remote.send({ type: "attachment-request", storyId: "../x", id: "a00000000-0000-4000-8000-000000000008" });
    remote.send({ type: "attachment-request", storyId: "ROW-01", id: "../../etc/passwd" });
    remote.send({ type: "attachment-request", storyId: "ROW-01" });
    await vi.waitFor(() => expect(remote.received).toHaveLength(4));

    expect(transport.uploads).toEqual([]);
    expect(remote.received).toHaveLength(4);
    expect(remote.received).toEqual(
      expect.arrayContaining([
        { type: "attachment-failed", id: record.id, message: `Attachment ${record.id} not found on ROW-99` },
        { type: "attachment-failed", id: unknownId, message: `Attachment ${unknownId} not found on ROW-01` },
        {
          type: "attachment-failed",
          id: "a00000000-0000-4000-8000-000000000008",
          message: "Invalid attachment Story ID",
        },
        { type: "attachment-failed", id: "../../etc/passwd", message: "Invalid attachment ID" },
      ]),
    );
  });

  it("sends attachment-failed for a missing file, a file larger than 10 MiB and a failed upload", async () => {
    const record = await attachment();
    const path = join(project.paths.dir, "attachments", "ROW-01", `${record.id}.txt`);
    expect(await readFile(path, "utf8")).toBe("the notes");
    const failing = await open(1);

    failing.remote.send({ type: "attachment-request", storyId: "ROW-01", id: record.id });
    await vi.waitFor(() => expect(failing.remote.received).toHaveLength(1));
    expect(failing.remote.received[0]).toMatchObject({
      type: "attachment-failed",
      id: record.id,
      message: expect.stringContaining("disk full"),
    });

    const { transport, remote } = await open();
    await writeFile(path, Buffer.alloc(10 * 1024 * 1024 + 1));
    remote.send({ type: "attachment-request", storyId: "ROW-01", id: record.id });
    await vi.waitFor(() => expect(remote.received).toHaveLength(1));
    expect(remote.received[0]).toMatchObject({ message: "Attachment exceeds 10 MiB" });

    const { rm } = await import("node:fs/promises");
    await rm(path);
    remote.send({ type: "attachment-request", storyId: "ROW-01", id: record.id });
    await vi.waitFor(() => expect(remote.received).toHaveLength(2));
    expect(remote.received[1]).toMatchObject({ message: expect.stringContaining("is missing on ROW-01") });
    expect(transport.uploads).toEqual([]);
  });
});
