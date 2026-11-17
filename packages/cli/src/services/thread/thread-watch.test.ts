import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { describe, expect, it, vi } from "vitest";
import { useTestProject } from "../test-project/test-project.js";
import { watchThreads } from "./thread-watch.js";

describe("thread watch", () => {
  const p = useTestProject();

  it("calls after a thread change and not after stop", async () => {
    const changed = vi.fn();
    const stop = await watchThreads(changed, p.ctx);

    await mkdir(join(p.paths.runtimeDir, "threads"), { recursive: true });
    await writeFile(join(p.paths.runtimeDir, "threads/a.json"), "{}");
    await vi.waitFor(() => expect(changed).toHaveBeenCalled());
    stop();

    const calls = changed.mock.calls.length;

    await writeFile(join(p.paths.runtimeDir, "threads/b.json"), "{}");
    await sleep(250);
    expect(changed).toHaveBeenCalledTimes(calls);
  });

  it("sees the first thread file in a Project without a runtime folder", async () => {
    const changed = vi.fn();
    const stop = await watchThreads(changed, p.ctx);

    try {
      await mkdir(join(p.paths.runtimeDir, "threads"), { recursive: true });
      await writeFile(join(p.paths.runtimeDir, "threads/a.json"), "{}");
      await vi.waitFor(() => expect(changed).toHaveBeenCalled());
    } finally {
      stop();
    }
  });

  it("calls after a write of the factory status only with the factory option", async () => {
    await mkdir(p.paths.runtimeDir, { recursive: true });
    const plain = vi.fn();
    const factory = vi.fn();
    const stopPlain = await watchThreads(plain, p.ctx);
    const stopFactory = await watchThreads(factory, p.ctx, { factory: true });

    try {
      await writeFile(join(p.paths.runtimeDir, "status.json"), "{}");
      await vi.waitFor(() => expect(factory).toHaveBeenCalled());
      await sleep(200);
      expect(plain).not.toHaveBeenCalled();
    } finally {
      stopPlain();
      stopFactory();
    }
  });
});
