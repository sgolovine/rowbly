import { Text } from "ink";
import { cleanup } from "ink-testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FactoryStatus } from "../../../../services/factory/factory.js";
import * as factory from "../../../../services/factory/factory.js";
import { useTestProject } from "../../../../services/test-project/test-project.js";
import { createThread } from "../../../../services/thread/thread.js";
import type { ServiceContext } from "../../../../services/workspace/workspace.js";
import { type AsyncState, FactoryStatusContext } from "../../../hooks/index.js";
import { renderTui } from "../../../testing/index.js";
import { useThreadsTab } from "./use-threads-tab.js";

vi.mock("../../../../services/factory/factory.js", async (original) => ({
  ...(await original<typeof import("../../../../services/factory/factory.js")>()),
  getFactoryStatus: vi.fn(async () => ({ version: 1, phase: "stopped" })),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function Probe({ ctx, selected, onHints }: { ctx: ServiceContext; selected: boolean; onHints: () => void }) {
  const tab = useThreadsTab({ ctx, storyId: "ROW-01", selected, onCount: () => {}, onEditing: () => {}, onHints });
  const state = tab.data.data ? `threads:${tab.threads.length}` : `opened:${tab.opened}`;

  return <Text>{`${state} focus:${tab.focus} listing:${tab.listing} waiting:${tab.waiting?.reason ?? "-"}`}</Text>;
}

/** The status read of a shell, which has the Story `ROW-01` in its queue. */
function sharedStatus(): AsyncState<FactoryStatus | undefined> {
  const data = {
    version: 1,
    phase: "ready",
    queue: [{ story: "ROW-01", stage: "DEVELOP", action: "skip", reason: "worker limit" }],
  } as FactoryStatus;

  return { loading: false, error: undefined, data, reload: () => {}, refresh: () => {} };
}

describe("useThreadsTab", () => {
  const project = useTestProject();

  it("reads nothing before the tab is selected", async () => {
    const tui = await renderTui(<Probe ctx={project.ctx} selected={false} onHints={vi.fn()} />);
    await vi.waitFor(() => expect(tui.frame()).toContain("opened:false"));
  });

  it("reads the threads of the Story when the tab is selected, and takes the list keys", async () => {
    await createThread(
      { role: "worker", storyId: "ROW-01", stage: "DEVELOP", cwd: project.paths.root, ownerToken: "owner" },
      project.ctx,
    );
    const onHints = vi.fn();
    const tui = await renderTui(<Probe ctx={project.ctx} selected onHints={onHints} />);
    await vi.waitFor(() => expect(tui.frame()).toContain("threads:1 focus:list listing:true"));
    expect(onHints).toHaveBeenLastCalledWith([
      { key: "↑/↓", description: "select" },
      { key: "enter/tab", description: "open" },
      { key: "x", description: "interrupt" },
    ]);
  });

  it("reads its own factory status when no shell shares one", async () => {
    const tui = await renderTui(<Probe ctx={project.ctx} selected onHints={vi.fn()} />);
    await vi.waitFor(() => expect(tui.frame()).toContain("threads:0"));
    expect(factory.getFactoryStatus).toHaveBeenCalled();
  });

  it("shows the queue entry from the shared status, reads no status itself, and reads the threads again", async () => {
    const tui = await renderTui(
      <FactoryStatusContext.Provider value={sharedStatus()}>
        <Probe ctx={project.ctx} selected onHints={vi.fn()} />
      </FactoryStatusContext.Provider>,
    );
    await vi.waitFor(() => expect(tui.frame()).toContain("threads:0"));
    expect(tui.frame()).toContain("waiting:worker limit");
    // A thread metadata change from a worker reads the list again.
    await createThread(
      { role: "worker", storyId: "ROW-01", stage: "DEVELOP", cwd: project.paths.root, ownerToken: "owner" },
      project.ctx,
    );
    await vi.waitFor(async () => {
      await tui.press();
      expect(tui.frame()).toContain("threads:1");
    });
    expect(factory.getFactoryStatus).not.toHaveBeenCalled();
  });
});
