import { Text } from "ink";
import { cleanup } from "ink-testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { updateProject } from "../../../../services/project/project.js";
import { createSpec } from "../../../../services/spec/spec.js";
import { createStory } from "../../../../services/story/story.js";
import { useTestProject } from "../../../../services/test-project/test-project.js";
import type { ServiceContext } from "../../../../services/workspace/workspace.js";
import { keys, renderTui } from "../../../testing/index.js";
import { useSpecsTab } from "./use-specs-tab.js";

afterEach(cleanup);

function Probe({ ctx, onEditing }: { ctx: ServiceContext; onEditing: (editing: boolean) => void }) {
  const tab = useSpecsTab({ ctx, storyId: "ROW-01", selected: true, onCount: () => {}, onEditing, onHints: () => {} });

  return <Text>{`specs:${tab.specs.length} mode:${tab.mode.kind} listing:${tab.listing}`}</Text>;
}

describe("useSpecsTab", () => {
  const project = useTestProject();

  beforeEach(async () => {
    await updateProject({ features: { specs: true } }, project.ctx);
    await createStory({ title: "Login" }, project.ctx);
    await createSpec({ title: "API", stories: ["ROW-01"] }, project.ctx);
  });

  it("lists the specs of the Story, and edits the selected spec with enter", async () => {
    const onEditing = vi.fn();
    const tui = await renderTui(<Probe ctx={project.ctx} onEditing={onEditing} />);
    await vi.waitFor(() => expect(tui.frame()).toContain("specs:1 mode:list listing:true"));
    await tui.press(keys.enter);
    expect(tui.frame()).toContain("mode:edit");
    expect(onEditing).toHaveBeenLastCalledWith(true);
    await tui.press(keys.escape);
    expect(tui.frame()).toContain("mode:list");
  });
});
