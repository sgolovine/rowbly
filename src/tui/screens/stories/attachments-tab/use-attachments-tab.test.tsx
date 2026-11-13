import { Text } from "ink";
import { cleanup } from "ink-testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createStory } from "../../../../services/story/story.js";
import { useTestProject } from "../../../../services/test-project/test-project.js";
import type { ServiceContext } from "../../../../services/workspace/workspace.js";
import { renderTui } from "../../../testing/index.js";
import { useAttachmentsTab } from "./use-attachments-tab.js";

afterEach(cleanup);

function Probe({ ctx, onTask }: { ctx: ServiceContext; onTask: (value: boolean) => void }) {
  const tab = useAttachmentsTab({ ctx, storyId: "ROW-01", selected: true, onHints: () => {}, onTask });

  return <Text>{`items:${tab.items.length} task:${tab.task} idle:${tab.idle}`}</Text>;
}

describe("useAttachmentsTab", () => {
  const project = useTestProject();

  it("reads the images of the Story, and tells when it asks a question", async () => {
    await createStory({ title: "Files" }, project.ctx);
    const onTask = vi.fn();
    const tui = await renderTui(<Probe ctx={project.ctx} onTask={onTask} />);
    await vi.waitFor(() => expect(tui.frame()).toContain("items:0 task:null idle:true"));
    expect(onTask).toHaveBeenLastCalledWith(false);
    await tui.press("n");
    expect(tui.frame()).toContain("task:path idle:false");
    expect(onTask).toHaveBeenLastCalledWith(true);
  });
});
