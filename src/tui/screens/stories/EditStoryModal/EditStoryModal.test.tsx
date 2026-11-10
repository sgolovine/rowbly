import { cleanup } from "ink-testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { addCustomField } from "../../../../services/customField/customField.js";
import { listStages } from "../../../../services/stage/stage.js";
import { createStory, getStory, searchStories } from "../../../../services/story/story.js";
import { useTestProject } from "../../../../services/testProject/testProject.js";
import { keys, renderTui, settle } from "../../../testing/index.js";
import { EditStoryModal } from "./EditStoryModal.js";

afterEach(cleanup);

describe("EditStoryModal", () => {
  const project = useTestProject();

  async function setup() {
    const field = await addCustomField({ label: "Points", type: "number" }, project.ctx);
    const story = await createStory(
      { title: "Fix login", description: "Use SSO.", fields: { points: 3 } },
      project.ctx,
    );
    const onSaved = vi.fn();
    const onClose = vi.fn();
    const onDeleted = vi.fn();
    const stages = await listStages(project.ctx);
    const tui = await renderTui(
      <EditStoryModal
        ctx={project.ctx}
        story={story}
        stages={stages}
        customFields={[field]}
        onSaved={onSaved}
        onDeleted={onDeleted}
        onClose={onClose}
      />,
    );
    return { tui, story, onSaved, onDeleted, onClose };
  }

  it("shows the current values of the Story", async () => {
    const frame = (await setup()).tui.frame();
    expect(frame).toContain("Edit ROW-01");
    expect(frame).toContain("Fix login");
    expect(frame).toContain("‹ Backlog ›");
    expect(frame).toContain("Use SSO.");
    expect(frame).toContain("3");
  });

  it("saves the changes with the service and reports them", async () => {
    const { tui, onSaved } = await setup();
    await tui.type(" now");
    await tui.press(keys.tab, keys.right, keys.tab, keys.tab);
    await tui.press(keys.backspace);
    await tui.press(keys.ctrl("s"));
    await settle(50);
    const story = await getStory({ id: "ROW-01" }, project.ctx);
    expect(story).toMatchObject({ title: "Fix login now", stage: "DONE", description: "Use SSO." });
    expect(story.fields.points).toBeNull();
    expect(onSaved).toHaveBeenCalledWith(story);
    expect(tui.toasts.list().map((t) => t.message)).toEqual(["Saved ROW-01"]);
  });

  it("deletes the Story with ctrl+d after a confirmation", async () => {
    const { tui, onDeleted } = await setup();
    expect(tui.frame()).toContain("Delete");
    expect(tui.frame()).toContain("ctrl+d");
    await tui.press(keys.ctrl("d"));
    expect(tui.frame()).toContain("Delete ROW-01 Fix login? You cannot undo this.");
    await tui.press("n");
    expect(tui.frame()).not.toContain("You cannot undo this.");
    expect(await searchStories({}, project.ctx)).toHaveLength(1);
    await tui.press(keys.ctrl("d"), "y");
    await settle(50);
    expect(await searchStories({}, project.ctx)).toEqual([]);
    expect(onDeleted).toHaveBeenCalledWith("ROW-01");
    expect(tui.toasts.list().map((t) => t.message)).toEqual(["Deleted ROW-01"]);
  });

  it("asks before it deletes the Story when the Delete Button is clicked", async () => {
    const { tui } = await setup();
    await tui.click("Delete");
    expect(tui.frame()).toContain("Delete ROW-01 Fix login? You cannot undo this.");
  });
});

describe("EditStoryModal image drafts", () => {
  const project = useTestProject();
  it("keeps draft images across tabs, confirms discard, and saves them once", async () => {
    const reader = vi.spyOn(await import("../../../../services/clipboard/clipboard.js"), "readClipboardImage");
    reader.mockResolvedValue({ bytes: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), type: "image/png" });
    const story = await createStory({ title: "Images" }, project.ctx);
    const onClose = vi.fn();
    const onSaved = vi.fn();
    const tui = await renderTui(
      <EditStoryModal
        ctx={project.ctx}
        story={story}
        stages={await listStages(project.ctx)}
        customFields={[]}
        onSaved={onSaved}
        onDeleted={() => {}}
        onClose={onClose}
      />,
    );
    await tui.press(keys.ctrl("v"));
    expect(reader).toHaveBeenCalled();
    expect(tui.frame()).toContain("1 pending image");
    const { listAttachments } = await import("../../../../services/attachment/attachment.js");
    expect(await listAttachments({ story: story.id }, project.ctx)).toEqual([]);
    await tui.click("Attachments");
    expect(tui.frame()).toContain("1 pending image");
    await tui.press(keys.escape);
    expect(tui.frame()).toContain("Close and discard unsaved changes?");
    await tui.press("n");
    const storyModule = await import("../../../../services/story/story.js");
    const save = vi.spyOn(storyModule, "updateStory").mockRejectedValueOnce(new Error("Save failed"));
    await tui.press(keys.ctrl("s"));
    await vi.waitFor(() => expect(tui.toasts.list().some((t) => t.message.includes("Save failed"))).toBe(true));
    expect(tui.frame()).toContain("1 pending image");
    expect(await listAttachments({ story: story.id }, project.ctx)).toEqual([]);
    await tui.press(keys.ctrl("s"));
    await vi.waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
    expect(await listAttachments({ story: story.id }, project.ctx)).toHaveLength(1);
    expect(tui.frame()).not.toContain("pending image");
    await tui.press(keys.ctrl("v"), keys.escape, "y");
    expect(onClose).toHaveBeenCalledOnce();
    expect(await listAttachments({ story: story.id }, project.ctx)).toHaveLength(1);
    save.mockRestore();
    reader.mockRestore();
  });
});
