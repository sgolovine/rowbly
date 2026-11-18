import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { addAttachment, listAttachments } from "../attachment/attachment.js";
import { addCustomField } from "../custom-field/custom-field.js";
import { withFileLock } from "../file-lock/file-lock.js";
import { pathExists } from "../files/files.js";
import { inboundDiff } from "../inbound/inbound-diff.js";
import type { InboundBody, InboundUpdate } from "../inbound/inbound-types.js";
import { createStory, deleteStory, getStory, updateStory } from "../story/story.js";
import { useTempDir, useTestProject } from "../test-project/test-project.js";
import type { ThreadRecord } from "../thread/thread.js";
import { buildThreadCopy, type ThreadCopy } from "../thread-copy/thread-copy.js";
import { hostCachePut } from "./host-agent-cache.js";
import { hostAgentPaths, threadPaths } from "./host-agent-paths.js";
import { prepareHostThread } from "./host-agent-prepare.js";
import { applyHostInbound, readInboundApplied } from "./host-inbound.js";

const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");

function thread(storyId: string): ThreadRecord {
  const createdAt = new Date().toISOString();
  return {
    version: 1,
    id: "t1",
    revision: 1,
    role: "worker",
    storyId,
    stage: "BACKLOG",
    status: "pending",
    createdAt,
    session: { id: "t1", file: null },
    cwd: "/main/project",
    runs: [{ id: "run-1", ownerToken: "owner", createdAt, status: "pending" }],
    resumable: false,
  };
}

function numbered(bodies: readonly InboundBody[], first = 1): InboundUpdate[] {
  return bodies.map((body, index) => ({ ...body, seq: first + index }));
}

/** Each file of the copy with its content, to compare two states of the copy. */
async function snapshot(root: string): Promise<Record<string, string>> {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  const files = entries.filter((entry) => entry.isFile());
  return Object.fromEntries(
    await Promise.all(
      files.map(async (entry) => {
        const path = join(entry.parentPath, entry.name);
        return [path, await readFile(path, "latin1")] as const;
      }),
    ),
  );
}

describe("host inbound", () => {
  const project = useTestProject();
  const home = useTempDir();
  const paths = () => hostAgentPaths("p1", home.path);
  const copyRoot = () => threadPaths(paths(), "t1").copy;
  const copyCtx = () => ({ cwd: copyRoot() });

  async function setup() {
    await addCustomField({ label: "Owner", type: "string", key: "owner" }, project.ctx);
    const own = await createStory({ title: "Own" }, project.ctx);
    const gone = await createStory({ title: "Gone" }, project.ctx);
    const base = await buildThreadCopy({ storyId: own.id }, project.ctx);
    await prepareHostThread(
      paths(),
      {
        threadId: "t1",
        thread: thread(own.id),
        storyId: own.id,
        clone: "repo",
        message: "Do the work",
        copy: base,
      },
      { home: home.path },
    );
    return { own, gone, base };
  }

  async function diffFrom(base: ThreadCopy, storyId: string) {
    const current = await buildThreadCopy({ storyId }, project.ctx);
    return inboundDiff({ base, current, fieldKeys: ["owner"] });
  }

  it("applies each update type to the copy", async () => {
    const f = await setup();
    const added = await createStory({ title: "Added" }, project.ctx);
    await updateStory({ id: f.own.id, title: "Main title", stage: "DONE", fields: { owner: "ana" } }, project.ctx);
    await deleteStory({ id: f.gone.id }, project.ctx);
    const attachment = (await addAttachment(
      { story: f.own.id, image: { name: "a.png", bytes: PNG } },
      project.ctx,
    )) as { id: string };
    await hostCachePut(paths(), attachment.id, PNG);
    await project.write("stages/BACKLOG.md", "Changed prompt\n");
    await project.write("specs/new-spec.md", "# Spec\n");
    const updates = numbered(await diffFrom(f.base, f.own.id));

    expect(await applyHostInbound(paths(), { threadId: "t1", updates })).toEqual({
      threadId: "t1",
      appliedSeq: updates.length,
    });

    const story = await getStory({ id: f.own.id }, copyCtx());
    expect(story).toMatchObject({ title: "Main title", stage: "DONE", fields: { owner: "ana" } });
    expect((await getStory({ id: added.id }, copyCtx())).title).toBe("Added");
    await expect(getStory({ id: f.gone.id }, copyCtx())).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await listAttachments({ story: f.own.id }, copyCtx())).map((record) => record.id)).toEqual([attachment.id]);
    expect(await readFile(join(copyRoot(), `.rowbly/attachments/${f.own.id}/${attachment.id}.png`))).toEqual(PNG);
    expect(await readFile(join(copyRoot(), ".rowbly/stages/BACKLOG.md"), "utf8")).toBe("Changed prompt\n");
    expect(await readFile(join(copyRoot(), ".rowbly/specs/new-spec.md"), "utf8")).toBe("# Spec\n");
    expect(await readInboundApplied(paths(), "t1")).toBe(updates.length);

    const next = numbered(
      [
        { type: "attachment.remove", storyId: f.own.id, id: attachment.id },
        { type: "file.delete", path: ".rowbly/specs/new-spec.md" },
      ],
      updates.length + 1,
    );
    await applyHostInbound(paths(), { threadId: "t1", updates: next });
    expect(await listAttachments({ story: f.own.id }, copyCtx())).toEqual([]);
    expect(await pathExists(join(copyRoot(), `.rowbly/attachments/${f.own.id}/${attachment.id}.png`))).toBe(false);
    expect(await pathExists(join(copyRoot(), ".rowbly/specs/new-spec.md"))).toBe(false);
  });

  it("keeps a value that the worker changed in the copy, and writes a change of a different field", async () => {
    const f = await setup();
    await updateStory({ id: f.own.id, fields: { owner: "worker" } }, copyCtx());
    const updates = numbered([
      {
        type: "story.update",
        storyId: f.own.id,
        changes: [
          { path: "fields.owner", before: null, after: "main" },
          { path: "title", before: "Own", after: "Main title" },
        ],
      },
    ]);

    expect(await applyHostInbound(paths(), { threadId: "t1", updates })).toEqual({ threadId: "t1", appliedSeq: 1 });
    expect(await getStory({ id: f.own.id }, copyCtx())).toMatchObject({
      title: "Main title",
      fields: { owner: "worker" },
    });
  });

  it("has no effect the second time, and gives the same last applied seq", async () => {
    const f = await setup();
    await createStory({ title: "Added" }, project.ctx);
    await updateStory({ id: f.own.id, title: "Main title" }, project.ctx);
    const updates = numbered(await diffFrom(f.base, f.own.id), 3);

    const first = await applyHostInbound(paths(), { threadId: "t1", updates });
    const before = await snapshot(copyRoot());
    const second = await applyHostInbound(paths(), { threadId: "t1", updates });

    expect(first).toEqual({ threadId: "t1", appliedSeq: 4 });
    expect(second).toEqual(first);
    expect(await snapshot(copyRoot())).toEqual(before);

    // An update with a new seq and a value that is already in the copy is also skipped.
    const again = updates.map((update, index) => ({ ...update, seq: 10 + index }));
    expect(await applyHostInbound(paths(), { threadId: "t1", updates: again })).toEqual({
      threadId: "t1",
      appliedSeq: 11,
    });
    expect(await snapshot(copyRoot())).toEqual(before);
  });

  it("writes no outbox entry and holds the Thread flock file while it applies", async () => {
    const f = await setup();
    const updates = numbered([
      { type: "story.update", storyId: f.own.id, changes: [{ path: "title", before: "Own", after: "Main" }] },
    ]);
    const lock = threadPaths(paths(), "t1").lock;
    const held = { release: () => {} };
    const holding = withFileLock(lock, () => new Promise<void>((resolve) => (held.release = resolve)));
    await new Promise((resolve) => setTimeout(resolve, 100));

    const applying = applyHostInbound(paths(), { threadId: "t1", updates });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect((await getStory({ id: f.own.id }, copyCtx())).title).toBe("Own");

    held.release();
    await holding;
    expect(await applying).toEqual({ threadId: "t1", appliedSeq: 1 });
    expect((await getStory({ id: f.own.id }, copyCtx())).title).toBe("Main");
    const outbox = (await pathExists(paths().outbox)) ? await readdir(paths().outbox) : [];
    expect(outbox).toEqual([]);
  });

  it("refuses a Thread that is not prepared and an update with a bad path, before a change", async () => {
    const f = await setup();

    await expect(applyHostInbound(paths(), { threadId: "t2", updates: [] })).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "Thread t2 is not prepared on this host",
    });
    await expect(
      applyHostInbound(paths(), {
        threadId: "t1",
        updates: [
          { seq: 1, type: "story.update", storyId: f.own.id, changes: [] },
          { seq: 2, type: "file.put", path: ".rowbly/../x", content: "x" },
        ],
      }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(
      applyHostInbound(paths(), { threadId: "t1", updates: [{ seq: 1, type: "story.move", storyId: f.own.id }] }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    expect(await readInboundApplied(paths(), "t1")).toBe(0);
  });
});
