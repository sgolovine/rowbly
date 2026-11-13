import { cleanup } from "ink-testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SKILL_HARNESSES } from "../../../../services/config/config.js";
import { ConflictError } from "../../../../services/errors/errors.js";
import * as skills from "../../../../services/skill/skill.js";
import { keys, renderTui } from "../../../testing/index.js";
import { SkillActionModal } from "./skill-action-modal.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("SkillActionModal", () => {
  it("shows all supported harnesses and rejects an empty selection", async () => {
    const install = vi.spyOn(skills, "installSkill");
    const tui = await renderTui(
      <SkillActionModal ctx={{}} mode="install" name="develop" onClose={() => {}} onSaved={() => {}} />,
    );
    for (const harness of SKILL_HARNESSES) expect(tui.frame()).toContain(harness);
    await tui.press(keys.ctrl("s"));
    expect(tui.frame()).toContain("Select at least one harness.");
    expect(install).not.toHaveBeenCalled();
  });
  it("cancels an edited install form without a write", async () => {
    const install = vi.spyOn(skills, "installSkill");
    const onClose = vi.fn();
    const tui = await renderTui(
      <SkillActionModal ctx={{}} mode="install" name="develop" onClose={onClose} onSaved={() => {}} />,
    );
    await tui.press(keys.space);
    await tui.click("Cancel");
    expect(onClose).toHaveBeenCalledOnce();
    expect(install).not.toHaveBeenCalled();
  });
  it("selects a harness and submits with mouse controls", async () => {
    const install = vi.spyOn(skills, "installSkill").mockResolvedValue({ name: "develop", harnesses: [] });
    const ctx = { cwd: "/test-project" };
    const saved = vi.fn();
    const tui = await renderTui(
      <SkillActionModal ctx={ctx} mode="install" name="develop" onClose={() => {}} onSaved={saved} />,
    );
    await tui.click("Not selected");
    await tui.click("Install  ");
    expect(install).toHaveBeenCalledWith({ name: "develop", harnesses: ["claude-code"] }, ctx);
    expect(saved).toHaveBeenCalledOnce();
  });
  it("blocks duplicate install submissions and closing during the operation", async () => {
    let resolve!: (result: skills.InstallSkillResult) => void;
    const install = vi.spyOn(skills, "installSkill").mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const saved = vi.fn();
    const close = vi.fn();
    const tui = await renderTui(
      <SkillActionModal ctx={{}} mode="install" name="develop" onClose={close} onSaved={saved} />,
    );
    await tui.press(keys.space, keys.ctrl("s"), keys.ctrl("s"), keys.escape);
    expect(install).toHaveBeenCalledOnce();
    expect(close).not.toHaveBeenCalled();
    expect(tui.frame()).toContain("Installing…");
    resolve({ name: "develop", harnesses: [] });
    await vi.waitFor(() => expect(saved).toHaveBeenCalledOnce());
  });
  it("blocks duplicate removal and lets the user retry after a service error", async () => {
    let reject!: (error: unknown) => void;
    const remove = vi
      .spyOn(skills, "removeSkill")
      .mockReturnValueOnce(
        new Promise((_, fail) => {
          reject = fail;
        }),
      )
      .mockResolvedValue({ name: "retired", harnesses: [] });
    const saved = vi.fn();
    const ctx = { cwd: "/test-project" };
    const tracked: skills.SkillStatus = {
      name: "retired",
      harnesses: [{ harness: "codex", path: "/test-project/.agents/skills/retired", installed: true }],
    };
    const tui = await renderTui(
      <SkillActionModal ctx={ctx} mode="remove" name="retired" tracked={tracked} onClose={() => {}} onSaved={saved} />,
    );
    await tui.press(keys.ctrl("s"), "y", "y", keys.escape);
    expect(remove).toHaveBeenCalledOnce();
    reject(new ConflictError("Removal failed", { hint: "Check the folder." }));
    await vi.waitFor(() => expect(tui.toasts.list()[0]?.message).toContain("Check the folder."));
    await vi.waitFor(() => expect(tui.frame()).toContain("ctrl+s continue"));
    await tui.press(keys.ctrl("s"), "y");
    expect(remove).toHaveBeenLastCalledWith({ name: "retired", harnesses: ["codex"] }, ctx);
    await vi.waitFor(() => expect(saved).toHaveBeenCalledOnce());
  });
});
