import { Text } from "ink";
import { cleanup } from "ink-testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AuthRuntime } from "../../../../services/agent-auth/agent-auth.js";
import { useTestProject } from "../../../../services/test-project/test-project.js";
import type { ServiceContext } from "../../../../services/workspace/workspace.js";
import type { KeyHint } from "../../../keymap.js";
import { keys, renderTui } from "../../../testing/index.js";
import { useModelsTab } from "./use-models-tab.js";

vi.mock("@earendil-works/pi-coding-agent", () => {
  throw new Error("The Models tab test must not load Pi");
});

afterEach(cleanup);

const runtime = {
  getAvailable: async () => [{ provider: "acme", id: "fast-1", name: "Fast One", reasoning: false }],
} as unknown as AuthRuntime;

function Probe(props: {
  ctx: ServiceContext;
  selected: boolean;
  onHints: (hints: readonly KeyHint[]) => void;
  onTask: (task: boolean) => void;
  onRender?: () => void;
}) {
  props.onRender?.();
  // A new `loadRuntime` on each render, as an inline prop gives.
  const tab = useModelsTab({ ...props, storyId: "ROW-01", loadRuntime: async () => runtime });

  return <Text>{`cursor=${tab.env.cursor} ready=${tab.env.ready} task=${tab.task?.key ?? "none"}`}</Text>;
}

describe("useModelsTab", () => {
  const project = useTestProject();

  it("reports its hints, moves with the arrows and opens the picker of the selected Stage", async () => {
    const onHints = vi.fn();
    const onTask = vi.fn();
    const tui = await renderTui(<Probe ctx={project.ctx} selected onHints={onHints} onTask={onTask} />);

    await vi.waitFor(async () => {
      await tui.press();
      expect(tui.frame()).toContain("cursor=0 ready=true task=none");
    });
    expect(onHints).toHaveBeenLastCalledWith([
      { key: "↑/↓", description: "select Stage" },
      { key: "enter", description: "change model" },
    ]);

    await tui.press(keys.down, keys.down, keys.enter);

    expect(tui.frame()).toContain("cursor=1 ready=true task=DONE");
    expect(onTask).toHaveBeenLastCalledWith(true);
  });

  it("takes no keys when the tab is not selected", async () => {
    const tui = await renderTui(<Probe ctx={project.ctx} selected={false} onHints={vi.fn()} onTask={vi.fn()} />);

    await tui.press(keys.down, keys.enter);

    expect(tui.frame()).toContain("cursor=0 ready=false task=none");
  });

  it("does not render again and again when `loadRuntime` is a new function on each render", async () => {
    const onRender = vi.fn();
    const tui = await renderTui(
      <Probe ctx={project.ctx} selected onHints={vi.fn()} onTask={vi.fn()} onRender={onRender} />,
    );

    await vi.waitFor(async () => {
      await tui.press();
      expect(tui.frame()).toContain("ready=true");
    });

    expect(onRender.mock.calls.length).toBeLessThan(20);
  });
});
