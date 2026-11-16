import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
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
    await createStory({ title: "First" }, project.ctx);
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
        changes: [{ path: "stage", before: "BACKLOG", after: "DONE" }],
      },
      {
        seq: 2,
        opId: expect.any(String),
        threadId: "thread-7",
        storyId: "ROW-01",
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
});
