import { readdir } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import { useTempDir } from "../test-project/test-project.js";
import type { ThreadRecord } from "../thread/thread.js";
import { openFactorySession } from "./factory-session.js";
import { loadPi } from "./pi-runtime.js";

vi.mock("./pi-runtime.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("./pi-runtime.js")>();

  return { ...original, loadPi: vi.fn(original.loadPi) };
});

describe("openFactorySession", () => {
  const dir = useTempDir();

  it("refuses a session without a model choice before it loads Pi", async () => {
    const thread = { id: "thread-1", cwd: dir.path, runs: [], session: {} } as unknown as ThreadRecord;

    await expect(
      openFactorySession({ thread, runtimeDir: dir.path, agentDir: dir.path, runtime: {} as never, tools: [] }),
    ).rejects.toMatchObject({ code: "VALIDATION", details: { setting: "factory.workerModel" } });
    expect(loadPi).not.toHaveBeenCalled();
    expect(await readdir(dir.path)).not.toContain("sessions");
  });
});
