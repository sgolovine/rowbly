import { Text } from "ink";
import { cleanup } from "ink-testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useTestProject } from "../../../../services/test-project/test-project.js";
import { createThread } from "../../../../services/thread/thread.js";
import type { ServiceContext } from "../../../../services/workspace/workspace.js";
import { renderTui } from "../../../testing/index.js";
import { useThreadsTab } from "./use-threads-tab.js";

vi.mock("../../../../services/factory/factory.js", async (original) => ({
  ...(await original<typeof import("../../../../services/factory/factory.js")>()),
  getFactoryStatus: vi.fn(async () => ({ version: 1, phase: "stopped" })),
}));

afterEach(cleanup);

function Probe({ ctx, selected, onHints }: { ctx: ServiceContext; selected: boolean; onHints: () => void }) {
  const tab = useThreadsTab({ ctx, storyId: "ROW-01", selected, onCount: () => {}, onEditing: () => {}, onHints });
  const state = tab.data.data ? `threads:${tab.threads.length}` : `opened:${tab.opened}`;

  return <Text>{`${state} focus:${tab.focus} listing:${tab.listing}`}</Text>;
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
});
