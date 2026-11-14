import { cleanup } from "ink-testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as clipboard from "../../../../services/clipboard/clipboard.js";
import { addCustomField } from "../../../../services/custom-field/custom-field.js";
import { listStages } from "../../../../services/stage/stage.js";
import { searchStories } from "../../../../services/story/story.js";
import { useTestProject } from "../../../../services/test-project/test-project.js";
import { keys, renderTui, settle } from "../../../testing/index.js";
import { NewStoryForm } from "./new-story-form.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("NewStoryForm", () => {
  const project = useTestProject();

  async function setup(stage?: string) {
    const onCreated = vi.fn();
    const onBack = vi.fn();
    const stages = await listStages(project.ctx);
    const tui = await renderTui(
      <NewStoryForm
        ctx={project.ctx}
        stages={stages}
        customFields={[{ key: "points", label: "Points", type: "number" }]}
        stage={stage}
        onCreated={onCreated}
        onBack={onBack}
      />,
    );
    return { tui, onCreated, onBack };
  }

  it("shows the title, Stage, description and custom fields", async () => {
    const frame = (await setup("DONE")).tui.frame();
    expect(frame).toContain("Title");
    expect(frame).toContain("‹ Done ›");
    expect(frame).toContain("Description");
    expect(frame).toContain("[Full screen]");
    expect(frame).toContain("Points");
  });

  it.each(["unsupported", "no-display"] as const)("shows a save-first fallback for %s", async (reason) => {
    vi.spyOn(clipboard, "readClipboardImage").mockResolvedValue({ reason });
    const { tui } = await setup();
    await tui.press(keys.ctrl("v"));
    const [toast] = tui.toasts.list();
    expect(toast?.kind).toBe("error");
    expect(toast?.message).toContain(
      reason === "unsupported"
        ? "Clipboard image access is unsupported"
        : "No display is available for clipboard access",
    );
    expect(toast?.message).toContain("Save the Story first, then use its Attachments tab to add a PNG file.");
    expect(toast?.message).not.toContain("rowbly add-attachment");
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

it("keeps a pasted image and the text after an invalid save and after esc", async () => {
  const clipboard = await import("../../../../services/clipboard/clipboard.js");
  const reader = vi.spyOn(clipboard, "readClipboardImage").mockResolvedValue({
    bytes: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    type: "image/png",
  });
  const onBack = vi.fn();
  const tui = await renderTui(
    <NewStoryForm ctx={{}} stages={[]} customFields={[]} onCreated={() => {}} onBack={onBack} />,
  );
  await tui.press(keys.ctrl("v"), keys.ctrl("s"));
  expect(tui.frame()).toContain("required");
  expect(tui.frame()).toContain("1 pending image");
  await tui.press(keys.escape);
  expect(onBack).toHaveBeenCalledOnce();
  expect(tui.frame()).toContain("1 pending image");
  reader.mockRestore();
});
