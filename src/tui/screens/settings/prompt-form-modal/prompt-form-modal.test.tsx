import { cleanup } from "ink-testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getPrompt } from "../../../../services/prompts/prompts.js";
import { useTestProject } from "../../../../services/test-project/test-project.js";
import { keys, renderTui, settle } from "../../../testing/index.js";
import { PromptFormModal } from "./prompt-form-modal.js";

afterEach(cleanup);

describe("PromptFormModal", () => {
  const project = useTestProject();

  it("shows the text of the prompt and saves the new text", async () => {
    await project.write("prompts/SUPERVISOR.md", "Start one worker.\n");
    const prompt = await getPrompt("supervisor", project.ctx);
    const onSaved = vi.fn();
    const tui = await renderTui(
      <PromptFormModal ctx={project.ctx} prompt={prompt} onSaved={onSaved} onClose={vi.fn()} />,
    );

    expect(tui.frame()).toContain("Edit Prompt › Supervisor");
    expect(tui.frame()).toContain("Start one worker.");

    await tui.type(" Then wait.");
    await tui.press(keys.ctrl("s"));
    await settle(50);

    expect((await getPrompt("supervisor", project.ctx)).text).toBe("Start one worker. Then wait.");
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ name: "supervisor" }));
  });

  it("closes with esc and changes nothing", async () => {
    const prompt = await getPrompt("worker", project.ctx);
    const onClose = vi.fn();
    const tui = await renderTui(
      <PromptFormModal ctx={project.ctx} prompt={prompt} onSaved={vi.fn()} onClose={onClose} />,
    );

    await tui.press(keys.escape);
    await settle(50);

    expect(onClose).toHaveBeenCalled();
    expect((await getPrompt("worker", project.ctx)).text).toBe("");
  });
});
