import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
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
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(changed).toHaveBeenCalledTimes(calls);
  });
});
