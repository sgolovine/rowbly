import { mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { cleanup } from "ink-testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConflictError } from "../../../../services/errors/errors.js";
import * as skills from "../../../../services/skill/skill.js";
import { useTestProject } from "../../../../services/test-project/test-project.js";
import { keys, renderTui } from "../../../testing/index.js";
import { SkillsSection } from "./skills-section.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("SkillsSection", () => {
  const project = useTestProject();
  beforeEach(async () => {
    project.ctx.skillsDir = join(project.paths.root, "bundled");
    await mkdir(join(project.ctx.skillsDir, "develop"), { recursive: true });
    await writeFile(join(project.ctx.skillsDir, "develop", "SKILL.md"), "bundled text");
  });
  async function setup() {
    const onChange = vi.fn();
    const tui = await renderTui(<SkillsSection ctx={project.ctx} onChange={onChange} />);
    await vi.waitFor(() => expect(tui.frame()).toContain("develop"));
    return { tui, onChange };
  }
  it("lists bundled and tracked names once and shows each harness path and state", async () => {
    await skills.installSkill({ name: "develop", harnesses: ["codex", "cursor"] }, project.ctx);
    await rm(join(project.paths.root, ".cursor/skills/develop"), { recursive: true });
    const { tui } = await setup();
    expect(tui.frame().match(/develop tracked/g)).toHaveLength(1);
    expect(tui.frame()).toContain("codex · installed");
    expect(tui.frame()).toContain("cursor · missing");
    expect(tui.frame()).toContain(join(project.paths.root, ".agents/skills/develop"));
    expect(tui.frame()).toContain("Another harness can still read");
  });
  it("selects a bundled skill by keyboard and mouse", async () => {
    await mkdir(join(join(project.paths.root, "bundled"), "review"));
    await writeFile(join(join(project.paths.root, "bundled"), "review/SKILL.md"), "review");
    const { tui } = await setup();
    await tui.press(keys.down, "i");
    expect(tui.frame()).toContain("Install skill › review");
    await tui.press(keys.escape);
    await tui.click("develop not installed");
    await tui.click("Install");
    expect(tui.frame()).toContain("Install skill › develop");
  });
  it("installs selected harnesses, refreshes the list and calls onChange", async () => {
    const { tui, onChange } = await setup();
    await tui.press("i", keys.space, keys.down, keys.space, keys.ctrl("s"));
    await vi.waitFor(() => expect(onChange).toHaveBeenCalledOnce());
    await tui.press();
    expect((await skills.listSkills(project.ctx))[0]?.harnesses.map((h) => h.harness)).toEqual([
      "claude-code",
      "codex",
    ]);
    expect(tui.frame()).toContain("codex · installed");
  });
  it("restores missing copies, adds harnesses and preserves local changes", async () => {
    await skills.installSkill({ name: "develop", harnesses: ["claude-code", "codex"] }, project.ctx);
    const local = join(project.paths.root, ".claude/skills/develop/SKILL.md");
    await writeFile(local, "local changes");
    await rm(join(project.paths.root, ".agents/skills/develop"), { recursive: true });
    const { tui, onChange } = await setup();
    await tui.press("i", keys.space, keys.down, keys.space, keys.down, keys.space, keys.ctrl("s"));
    await vi.waitFor(() => expect(onChange).toHaveBeenCalledOnce());
    expect(await readFile(local, "utf8")).toBe("local changes");
    expect((await skills.listSkills(project.ctx))[0]?.harnesses).toHaveLength(3);
    expect((await skills.listSkills(project.ctx))[0]?.harnesses.every((h) => h.installed)).toBe(true);
  });
  it("shows a conflict and its hint, then lets the user cancel", async () => {
    await mkdir(join(project.paths.root, ".claude/skills/develop"), { recursive: true });
    await writeFile(join(project.paths.root, ".claude/skills/develop/local.txt"), "keep");
    const { tui, onChange } = await setup();
    await tui.press("i", keys.space, keys.ctrl("s"));
    await vi.waitFor(() => expect(tui.toasts.list().some((t) => t.message.includes("Move or delete it"))).toBe(true));
    expect(onChange).not.toHaveBeenCalled();
    await tui.press(keys.escape);
    expect(tui.frame()).not.toContain("Install skill ›");
    expect(await readFile(join(project.paths.root, ".claude/skills/develop/local.txt"), "utf8")).toBe("keep");
  });
  it.each([keys.escape, "n"])("cancels removal confirmation with %j without a write", async (cancel) => {
    await skills.installSkill({ name: "develop", harnesses: ["codex"] }, project.ctx);
    const { tui, onChange } = await setup();
    await tui.press("d", keys.ctrl("s"));
    expect(tui.frame()).toContain("Removal deletes local changes");
    expect(tui.frame()).toContain(join(project.paths.root, ".agents/skills/develop"));
    await tui.press(cancel, keys.escape);
    expect((await skills.listSkills(project.ctx))[0]?.harnesses).toHaveLength(1);
    expect(onChange).not.toHaveBeenCalled();
  });
  it("removes only selected harnesses and reports missing copies", async () => {
    await skills.installSkill({ name: "develop", harnesses: ["claude-code", "codex", "cursor"] }, project.ctx);
    await rm(join(project.paths.root, ".agents/skills/develop"), { recursive: true });
    const { tui, onChange } = await setup();
    await tui.press("d", keys.down, keys.down, keys.space, keys.ctrl("s"));
    expect(tui.frame()).toContain("claude-code:");
    await tui.press("y");
    await vi.waitFor(() => expect(onChange).toHaveBeenCalledOnce());
    await tui.press();
    expect((await skills.listSkills(project.ctx))[0]?.harnesses.map((h) => h.harness)).toEqual(["cursor"]);
    expect(tui.toasts.list().some((t) => t.message.includes("claude-code: removed; codex: already missing"))).toBe(
      true,
    );
    expect(tui.frame()).toContain("cursor · installed");
  });
  it("keeps shared folders and reports the result", async () => {
    await mkdir(join(project.paths.root, ".claude"));
    await skills.installSkill({ name: "develop", harnesses: ["codex"] }, project.ctx);
    await symlink(join(project.paths.root, ".agents/skills"), join(project.paths.root, ".claude/skills"));
    await skills.installSkill({ name: "develop", harnesses: ["claude-code"] }, project.ctx);
    const { tui, onChange } = await setup();
    await tui.press("d", keys.space, keys.ctrl("s"), "y");
    await vi.waitFor(() => expect(onChange).toHaveBeenCalledOnce());
    expect(tui.toasts.list().some((t) => t.message.includes("shared (folder kept)"))).toBe(true);
    expect((await skills.listSkills(project.ctx))[0]?.harnesses[0]?.installed).toBe(true);
  });
  it("keeps retired tracked skills removable with install unavailable", async () => {
    await skills.installSkill({ name: "develop", harnesses: ["codex"] }, project.ctx);
    await rm(join(project.paths.root, "bundled"), { recursive: true });
    const { tui, onChange } = await setup();
    expect(tui.frame()).toContain("No longer bundled. Install is unavailable.");
    await tui.press("i");
    expect(tui.frame()).not.toContain("Install skill ›");
    await tui.click("Uninstall");
    await tui.click("Continue");
    await tui.click("Uninstall  y");
    await vi.waitFor(() => expect(onChange).toHaveBeenCalledOnce());
    expect(await skills.listSkills(project.ctx)).toEqual([]);
  });
  it("shows load, empty and error states, with reload after failure", async () => {
    const load = vi.spyOn(skills, "bundledSkills").mockReturnValueOnce(new Promise(() => {}));
    const tui = await renderTui(<SkillsSection ctx={project.ctx} onChange={() => {}} />);
    expect(tui.frame()).toContain("Loading skills…");
    tui.unmount();
    load.mockRejectedValueOnce(new ConflictError("Cannot read skills", { hint: "Check permissions." }));
    const failed = await renderTui(<SkillsSection ctx={project.ctx} onChange={() => {}} />);
    await vi.waitFor(() => expect(failed.frame()).toContain("Cannot load skills"));
    expect(failed.toasts.list()[0]?.message).toContain("Check permissions.");
    load.mockResolvedValue({ dir: "unused", names: [] });
    await failed.click("Reload");
    await vi.waitFor(() => expect(failed.frame()).toContain("No bundled or tracked skills."));
  });
  it("keeps filter letters from opening an action", async () => {
    const { tui } = await setup();
    await tui.press("/", "i");
    expect(tui.frame()).not.toContain("Install skill ›");
  });
});
