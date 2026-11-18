import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { addAttachment } from "../../services/attachment/attachment.js";
import { putCachedAttachment } from "../../services/attachment-cache/attachment-cache.js";
import { hostAgentPaths } from "../../services/host-agent/host-agent-paths.js";
import { createStory, getStory } from "../../services/story/story.js";
import { useTempDir, useTestProject } from "../../services/test-project/test-project.js";
import { runCli } from "../test-cli/test-cli.js";
import { commandContext } from "./outbox-env.js";

describe("commandContext", () => {
  it("has no recorder without ROWBLY_OUTBOX", () => {
    expect(commandContext("/p", {})).toEqual({ cwd: "/p" });
  });

  it("has a recorder with ROWBLY_OUTBOX and ROWBLY_THREAD_ID", () => {
    expect(commandContext("/p", { ROWBLY_OUTBOX: "/o", ROWBLY_THREAD_ID: "t" }).recorder).toBeDefined();
  });

  it("has an attachment source only with ROWBLY_HOST_AGENT in a remote context", () => {
    const agent = "/h/.local/share/rowbly/projects/p1/agent";
    expect(commandContext("/p", { ROWBLY_OUTBOX: "/o", ROWBLY_THREAD_ID: "t" }).remoteAttachments).toBeUndefined();
    expect(
      commandContext("/p", { ROWBLY_OUTBOX: "/o", ROWBLY_THREAD_ID: "t", ROWBLY_HOST_AGENT: agent }).remoteAttachments,
    ).toBeDefined();
    expect(commandContext("/p", { ROWBLY_HOST_AGENT: agent })).toEqual({ cwd: "/p" });
    expect(() =>
      commandContext("/p", { ROWBLY_OUTBOX: "/o", ROWBLY_THREAD_ID: "t", ROWBLY_HOST_AGENT: "relative" }),
    ).toThrow(expect.objectContaining({ code: "VALIDATION" }));
  });

  it("gives a ValidationError without ROWBLY_THREAD_ID or with a relative folder", () => {
    expect(() => commandContext("/p", { ROWBLY_OUTBOX: "/o" })).toThrow(
      expect.objectContaining({ code: "VALIDATION" }),
    );
    expect(() => commandContext("/p", { ROWBLY_OUTBOX: "o", ROWBLY_THREAD_ID: "t" })).toThrow(
      expect.objectContaining({ code: "VALIDATION" }),
    );
  });
});

describe("CLI writes with an outbox", () => {
  const project = useTestProject();
  const outbox = useTempDir();
  const cli = (...args: string[]) => runCli(["--json", ...args], project.ctx.cwd);
  const lines = async () =>
    (await readFile(join(outbox.path, "outbox.jsonl"), "utf8"))
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("writes the change and appends one entry for each story update", async () => {
    const { uid } = await createStory({ title: "First" }, project.ctx);
    vi.stubEnv("ROWBLY_OUTBOX", outbox.path);
    vi.stubEnv("ROWBLY_THREAD_ID", "thread-7");

    const first = await cli("story", "update", "ROW-01", "--stage", "DONE");
    const second = await cli("story", "update", "ROW-01", "--title", "Renamed");

    expect([first.exitCode, second.exitCode]).toEqual([0, 0]);
    expect(await getStory({ id: "ROW-01" }, project.ctx)).toMatchObject({ title: "Renamed", stage: "DONE" });
    expect(await lines()).toEqual([
      {
        seq: 1,
        opId: expect.any(String),
        threadId: "thread-7",
        storyId: "ROW-01",
        storyUid: uid,
        changes: [{ path: "stage", before: "BACKLOG", after: "DONE" }],
      },
      {
        seq: 2,
        opId: expect.any(String),
        threadId: "thread-7",
        storyId: "ROW-01",
        storyUid: uid,
        changes: [{ path: "title", before: "First", after: "Renamed" }],
      },
    ]);
  });

  it("refuses a new Story with a CONFLICT error", async () => {
    vi.stubEnv("ROWBLY_OUTBOX", outbox.path);
    vi.stubEnv("ROWBLY_THREAD_ID", "thread-7");

    const result = await cli("story", "create", "--title", "New");

    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stderr).error).toMatchObject({
      code: "CONFLICT",
      message: "A remote worker cannot create a Story",
    });
  });

  it("fails with a VALIDATION error before it writes when ROWBLY_THREAD_ID is missing", async () => {
    await createStory({ title: "First" }, project.ctx);
    vi.stubEnv("ROWBLY_OUTBOX", outbox.path);
    vi.stubEnv("ROWBLY_THREAD_ID", "");

    const result = await cli("story", "update", "ROW-01", "--title", "Renamed");

    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stderr).error.code).toBe("VALIDATION");
    expect(await getStory({ id: "ROW-01" }, project.ctx)).toMatchObject({ title: "First" });
  });

  it("gets a missing attachment file from the cache of the host agent with get-attachment", async () => {
    await createStory({ title: "First" }, project.ctx);
    const file = join(project.paths.root, "notes.txt");
    await writeFile(file, "notes");
    const record = await addAttachment({ story: "ROW-01", file }, project.ctx);
    const copyFile = join(project.paths.dir, "attachments", "ROW-01", `${record.id}.txt`);
    await rm(copyFile);
    const agent = hostAgentPaths("p1", outbox.path);
    vi.stubEnv("ROWBLY_OUTBOX", agent.outbox);
    vi.stubEnv("ROWBLY_THREAD_ID", "thread-7");

    const missing = await cli("get-attachment", "ROW-01", record.id);
    expect(JSON.parse(missing.stderr).error.code).toBe("NOT_FOUND");

    vi.stubEnv("ROWBLY_HOST_AGENT", agent.dir);
    const offline = await cli("get-attachment", "ROW-01", record.id);
    expect(JSON.parse(offline.stderr).error).toMatchObject({ code: "CONFLICT" });

    await putCachedAttachment({ dir: agent.attachments, id: record.id, bytes: Buffer.from("notes") });
    const result = await cli("get-attachment", "ROW-01", record.id);

    expect(JSON.parse(result.stdout)).toEqual({ ...record, path: copyFile });
    expect(await readFile(copyFile, "utf8")).toBe("notes");
  });
});
