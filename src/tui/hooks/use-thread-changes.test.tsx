import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Text } from "ink";
import { cleanup } from "ink-testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useTestProject } from "../../services/test-project/test-project.js";
import * as thread from "../../services/thread/thread.js";
import { createThread } from "../../services/thread/thread.js";
import { renderTui, settle } from "../testing/index.js";
import { useFactoryChanges, useThreadChanges } from "./use-thread-changes.js";

vi.mock("../../services/thread/thread.js", async (original) => {
  const actual = await original<typeof import("../../services/thread/thread.js")>();
  return { ...actual, watchThreads: vi.fn(actual.watchThreads) };
});

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

  it("reads the factory status again 5 s after the last read, because a crash writes no file", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const onFactory = vi.fn();
    await renderTui(<Probe root={project.paths.root} onThreads={() => {}} onFactory={onFactory} />);
    vi.advanceTimersByTime(4999);
    expect(onFactory).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onFactory).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(5000);
    expect(onFactory).toHaveBeenCalledTimes(2);
  });

  it("starts the timer again after a read from a file event", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const events: Array<() => void> = [];
    vi.mocked(thread.watchThreads).mockImplementation(async (onChange) => {
      events.push(onChange);
      return () => {};
    });
    const onFactory = vi.fn();
    await renderTui(<FactoryProbe root={project.paths.root} onFactory={onFactory} />);
    await vi.waitFor(() => expect(events).toHaveLength(1));
    vi.advanceTimersByTime(3000);
    events[0]?.();
    expect(onFactory).toHaveBeenCalledOnce();
    // The timer read does not occur 5 s after the start, only 5 s after the file event read.
    vi.advanceTimersByTime(4999);
    expect(onFactory).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(1);
    expect(onFactory).toHaveBeenCalledTimes(2);
    vi.mocked(thread.watchThreads).mockReset();
  });
});

function FactoryProbe({ root, onFactory }: { root: string; onFactory(): void }) {
  useFactoryChanges(root, onFactory);
  return <Text>watching</Text>;
}
