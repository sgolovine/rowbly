import { cleanup } from "ink-testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getStage, listStages } from "../../../../services/stage/stage.js";
import { useTestProject } from "../../../../services/testProject/testProject.js";
import { keys, renderTui, settle } from "../../../testing/index.js";
import { StageFormModal } from "./StageFormModal.js";

afterEach(cleanup);

describe("StageFormModal", () => {
  const project = useTestProject();

  it("creates a Stage with its name and prompt", async () => {
    const onSaved = vi.fn();
    const tui = await renderTui(<StageFormModal ctx={project.ctx} onSaved={onSaved} onClose={() => {}} />);
    expect(tui.frame()).toContain("New Stage");
    expect(tui.frame()).toContain("Prompt");
    await tui.type("In Review");
    await tui.press(keys.tab, keys.tab);
    await tui.type("Review the diff.");
    await tui.press(keys.ctrl("s"));
    await settle(50);
    const stage = await getStage({ key: "IN_REVIEW" }, project.ctx);
    expect(stage).toMatchObject({ label: "In Review", enabled: true, prompt: "Review the diff." });
    expect(onSaved).toHaveBeenCalledWith(stage);
  });

  it("edits a Stage, with its values in the fields", async () => {
    const [backlog] = await listStages(project.ctx);
    const onSaved = vi.fn();
    const tui = await renderTui(
      <StageFormModal ctx={project.ctx} stage={backlog} onSaved={onSaved} onClose={() => {}} />,
    );
    expect(tui.frame()).toContain("Edit Stage › Backlog");
    expect(tui.frame()).toContain("This story has not been started.");
    await tui.type(" ideas");
    await tui.press(keys.ctrl("s"));
    await settle(50);
    expect((await getStage({ key: "BACKLOG" }, project.ctx)).label).toBe("Backlog ideas");
    expect(onSaved).toHaveBeenCalledOnce();
  });

  it("disables a Stage with the Status switch", async () => {
    const [backlog] = await listStages(project.ctx);
    const tui = await renderTui(
      <StageFormModal ctx={project.ctx} stage={backlog} onSaved={() => {}} onClose={() => {}} />,
    );
    expect(tui.frame()).toContain("Enabled");
    await tui.press(keys.tab, keys.space);
    expect(tui.frame()).toContain("Disabled");
    await tui.press(keys.ctrl("s"));
    await settle(50);
    expect((await getStage({ key: "BACKLOG" }, project.ctx)).enabled).toBe(false);
  });

  it("shows a service error under its field", async () => {
    const tui = await renderTui(<StageFormModal ctx={project.ctx} onSaved={() => {}} onClose={() => {}} />);
    await tui.type("Done");
    await tui.press(keys.ctrl("s"));
    await settle(50);
    expect(
      tui.toasts
        .list()
        .map((t) => t.message)
        .join(),
    ).toContain("Stage DONE already exists");
  });
});
