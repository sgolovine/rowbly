import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Text } from "ink";
import { cleanup } from "ink-testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useTestProject } from "../../services/test-project/test-project.js";
import { createThread } from "../../services/thread/thread.js";
import { renderTui, settle } from "../testing/index.js";
import { useFactoryChanges, useThreadChanges } from "./use-thread-changes.js";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function Probe({ root, onThreads, onFactory }: { root: string; onThreads(): void; onFactory(): void }) {
  useThreadChanges(root, onThreads);
  useFactoryChanges(root, onFactory);
  return <Text>watching</Text>;
}

describe("useThreadChanges", () => {
  const project = useTestProject();

  it("calls back for thread metadata and for the factory status, but not for session histories", async () => {
    const onThreads = vi.fn();
    const onFactory = vi.fn();
    const tui = await renderTui(<Probe root={project.paths.root} onThreads={onThreads} onFactory={onFactory} />);
    await settle(50);
    await mkdir(join(project.paths.runtimeDir, "sessions/x"), { recursive: true });
    await writeFile(join(project.paths.runtimeDir, "sessions/x/history.jsonl"), "{}\n");
    await writeFile(join(project.paths.runtimeDir, "status.json"), "{}\n");
    await vi.waitFor(() => expect(onFactory).toHaveBeenCalled());
    expect(onThreads).not.toHaveBeenCalled();
    await createThread(
      { role: "worker", storyId: "ROW-01", stage: "BACKLOG", cwd: project.paths.root, ownerToken: "t" },
      project.ctx,
    );
    await vi.waitFor(() => expect(onThreads).toHaveBeenCalled());
    onThreads.mockClear();
    tui.unmount();
    await createThread(
      { role: "worker", storyId: "ROW-01", stage: "BACKLOG", cwd: project.paths.root, ownerToken: "t" },
      project.ctx,
    );
    await settle(250);
    expect(onThreads).not.toHaveBeenCalled();
  });

  it("reads the factory status again on a timer, because a crash writes no file", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const onFactory = vi.fn();
    await renderTui(<Probe root={project.paths.root} onThreads={() => {}} onFactory={onFactory} />);
    vi.advanceTimersByTime(5000);
    expect(onFactory).toHaveBeenCalledOnce();
  });
});
