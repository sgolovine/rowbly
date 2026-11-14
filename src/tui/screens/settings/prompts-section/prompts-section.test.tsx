import { rm } from "node:fs/promises";
import { join } from "node:path";
import { cleanup } from "ink-testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getPrompt } from "../../../../services/prompts/prompts.js";
import { useTestProject } from "../../../../services/test-project/test-project.js";
import { keys, renderTui, settle } from "../../../testing/index.js";
import { PromptsSection } from "./prompts-section.js";

afterEach(cleanup);

describe("PromptsSection", () => {
  const project = useTestProject();

  async function setup() {
    const onChange = vi.fn();
    const tui = await renderTui(<PromptsSection ctx={project.ctx} onChange={onChange} />);
    await settle(50);
    await tui.press();
    return { tui, onChange };
  }

  it("lists the three user prompts with their state", async () => {
    await project.write("prompts/WORKER.md", "Use pnpm.\nWrite tests.\n");
    await rm(join(project.paths.promptsDir, "SUPERVISOR.md"));

    const { tui } = await setup();

    expect(tui.frame()).toMatch(/▌ Project\s+empty\s+The supervisor and all workers\./);
    expect(tui.frame()).toMatch(/Supervisor\s+missing\s+The supervisor only\./);
    expect(tui.frame()).toMatch(/Worker\s+2 lines\s+All workers, in all Stages\./);
  });

  it("edits the selected prompt with enter, and saves it", async () => {
    const { tui, onChange } = await setup();

    await tui.press(keys.down, keys.down, keys.enter);
    expect(tui.frame()).toContain("Edit Prompt › Worker");

    await tui.type("Use pnpm.");
    await tui.press(keys.ctrl("s"));
    await settle(50);
    await tui.press();

    expect((await getPrompt("worker", project.ctx)).text).toBe("Use pnpm.");
    expect(tui.frame()).toMatch(/Worker\s+1 line/);
    expect(onChange).toHaveBeenCalled();
  });

  it("creates a missing prompt when the user saves it", async () => {
    await rm(project.paths.promptsDir, { recursive: true });

    const { tui } = await setup();

    await tui.press(keys.enter);
    await tui.type("Run the tests first.");
    await tui.press(keys.ctrl("s"));
    await settle(50);

    expect((await getPrompt("system", project.ctx)).text).toBe("Run the tests first.");
  });
});
