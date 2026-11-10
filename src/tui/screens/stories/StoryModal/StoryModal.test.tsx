import { cleanup } from "ink-testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { updateProject } from "../../../../services/project/project.js";
import { createStory } from "../../../../services/story/story.js";
import { useTestProject } from "../../../../services/testProject/testProject.js";
import { keys, renderTui } from "../../../testing/index.js";
import { StoryModal } from "./StoryModal.js";

afterEach(cleanup);

describe("StoryModal", () => {
  const project = useTestProject();

  beforeEach(async () => {
    await updateProject({ features: { specs: true } }, project.ctx);
    await createStory({ title: "Login" }, project.ctx);
  });

  async function setup() {
    const onClose = vi.fn();
    const tui = await renderTui(
      <StoryModal
        ctx={project.ctx}
        storyId="ROW-01"
        title="Edit ROW-01"
        fields={[{ name: "title", label: "Title", kind: "text", required: true }]}
        initialValues={{ title: "Login" }}
        onSubmit={() => {}}
        onClose={onClose}
        onDelete={{ title: "Delete Story", message: "Delete it?", onConfirm: () => {} }}
      />,
    );
    await vi.waitFor(async () => {
      await tui.press();
      expect(tui.frame()).toContain("Specs 0");
    });
    return { tui, onClose };
  }

  it("shows the title and the tabs", async () => {
    const { tui } = await setup();
    expect(tui.frame()).toContain("Edit ROW-01");
    expect(tui.frame()).toContain("General");
    expect(tui.frame()).toContain("Attachments");
    expect(tui.frame()).toContain("Specs 0");
  });

  it("closes with esc when nothing changed", async () => {
    const { tui, onClose } = await setup();
    await tui.press(keys.escape);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("asks before it discards changes", async () => {
    const { tui, onClose } = await setup();
    await tui.type("!");
    await tui.press(keys.escape);
    expect(tui.frame()).toContain("Close and discard unsaved changes?");
    expect(onClose).not.toHaveBeenCalled();
    await tui.press("y");
    expect(onClose).toHaveBeenCalledOnce();
  });
});
