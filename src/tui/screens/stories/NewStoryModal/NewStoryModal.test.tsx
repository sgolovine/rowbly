import { cleanup } from "ink-testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { addCustomField } from "../../../../services/customField/customField.js";
import { listStages } from "../../../../services/stage/stage.js";
import { searchStories } from "../../../../services/story/story.js";
import { useTestProject } from "../../../../services/testProject/testProject.js";
import { keys, renderTui, settle } from "../../../testing/index.js";
import { NewStoryModal } from "./NewStoryModal.js";

afterEach(cleanup);

describe("NewStoryModal", () => {
  const project = useTestProject();

  async function setup(stage?: string) {
    const onCreated = vi.fn();
    const onClose = vi.fn();
    const stages = await listStages(project.ctx);
    const tui = await renderTui(
      <NewStoryModal
        ctx={project.ctx}
        stages={stages}
        customFields={[{ key: "points", label: "Points", type: "number" }]}
        stage={stage}
        onCreated={onCreated}
        onClose={onClose}
      />,
    );
    return { tui, onCreated, onClose };
  }

  it("shows the title, Stage, description and custom fields", async () => {
    const frame = (await setup("DONE")).tui.frame();
    expect(frame).toContain("New Story");
    expect(frame).toContain("‹ Done ›");
    expect(frame).toContain("Description");
    expect(frame).toContain("[Full screen]");
    expect(frame).toContain("Points");
  });

  it("creates the Story with the service and reports it", async () => {
    await addCustomField({ label: "Points", type: "number" }, project.ctx);
    const { tui, onCreated } = await setup();
    await tui.type("Fix login");
    await tui.press(keys.tab, keys.right, keys.tab);
    await tui.type("Use **SSO**.");
    await tui.press(keys.tab);
    await tui.type("3");
    await tui.press(keys.ctrl("s"));
    await settle(50);
    const [story] = await searchStories({}, project.ctx);
    expect(story).toMatchObject({ title: "Fix login", stage: "DONE", description: "Use **SSO**." });
    expect(story?.fields.points).toBe(3);
    expect(onCreated).toHaveBeenCalledWith(story);
    expect(tui.toasts.list().map((t) => t.message)).toEqual(["Created ROW-01"]);
  });
});

it("keeps a pasted image after invalid save and asks before discard", async () => {
  const clipboard = await import("../../../../services/clipboard/clipboard.js");
  const reader = vi.spyOn(clipboard, "readClipboardImage").mockResolvedValue({
    bytes: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    type: "image/png",
  });
  const onClose = vi.fn();
  const tui = await renderTui(
    <NewStoryModal ctx={{}} stages={[]} customFields={[]} onCreated={() => {}} onClose={onClose} />,
  );
  await tui.press(keys.ctrl("v"), keys.ctrl("s"));
  expect(tui.frame()).toContain("required");
  expect(tui.frame()).toContain("1 pending image");
  await tui.press(keys.escape);
  expect(tui.frame()).toContain("Close and discard unsaved changes?");
  expect(onClose).not.toHaveBeenCalled();
  await tui.press("y");
  expect(onClose).toHaveBeenCalledOnce();
  reader.mockRestore();
});
