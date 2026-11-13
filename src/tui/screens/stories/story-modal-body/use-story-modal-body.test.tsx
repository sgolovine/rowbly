import { Text } from "ink";
import { cleanup } from "ink-testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useTestProject } from "../../../../services/test-project/test-project.js";
import type { ServiceContext } from "../../../../services/workspace/workspace.js";
import { keys, renderTui } from "../../../testing/index.js";
import { useStoryModalBody } from "./use-story-modal-body.js";

afterEach(cleanup);

function Probe({ ctx, onConfirming }: { ctx: ServiceContext; onConfirming: (confirm: unknown) => void }) {
  const body = useStoryModalBody({
    ctx,
    storyId: "ROW-01",
    specs: false,
    fields: [],
    initialValues: {},
    onSubmit: () => {},
    onClose: () => {},
    onRequestClose: () => {},
    onDelete: { title: "Delete Story", message: "Delete it?", onConfirm: () => {} },
    confirming: null,
    onConfirming,
    onHints: () => {},
  });

  return <Text>{`${body.labels.join("|")} shown:${body.env.shown}`}</Text>;
}

describe("useStoryModalBody", () => {
  const project = useTestProject();

  it("starts on the General tab, changes the tab with shift+tab, and asks to delete only on General", async () => {
    const onConfirming = vi.fn();
    const tui = await renderTui(<Probe ctx={project.ctx} onConfirming={onConfirming} />);
    expect(tui.frame()).toContain("General|Attachments|Threads shown:general");
    await tui.press(keys.shiftTab);
    expect(tui.frame()).toContain("shown:attachments");
    await tui.press(keys.ctrl("d"));
    expect(onConfirming).not.toHaveBeenCalled();
  });
});
