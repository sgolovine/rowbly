import { describe, expect, it, vi } from "vitest";
import { ValidationError } from "../../../../services/errors/errors.js";
import * as skills from "../../../../services/skill/skill.js";
import { createToastStore } from "../../../hooks/index.js";
import { removalMessage, type SkillActionEnv, submitSkillForm } from "./skill-action.js";

vi.mock("../../../../services/skill/skill.js", async (original) => ({
  ...(await original<typeof import("../../../../services/skill/skill.js")>()),
  installSkill: vi.fn(async () => ({
    harnesses: [
      { harness: "codex", path: "a", status: "shared" },
      { harness: "cursor", path: "b", status: "installed" },
      { harness: "gemini-cli", path: "c", status: "missing" },
    ],
  })),
}));

function env(overrides: Partial<SkillActionEnv> = {}): SkillActionEnv {
  return {
    ctx: {},
    mode: "remove",
    name: "develop",
    harnesses: ["codex", "cursor"],
    toast: createToastStore(),
    pending: { current: false },
    setBusy: vi.fn(),
    setTargets: vi.fn(),
    onSaved: vi.fn(),
    ...overrides,
  };
}

describe("skillAction", () => {
  it("installs at once and names the result of each harness", async () => {
    const e = env({ mode: "install" });

    await submitSkillForm(e, { codex: true, cursor: true });

    expect(skills.installSkill).toHaveBeenCalledWith({ name: "develop", harnesses: ["codex", "cursor"] }, {});
    expect(e.toast.list().map((t) => t.message)).toEqual(["develop: codex: shared (folder kept); cursor: installed; gemini-cli: already missing"]);
    expect(e.setBusy).toHaveBeenLastCalledWith(false);
    expect(e.onSaved).toHaveBeenCalledOnce();
    expect(e.pending.current).toBe(false);
  });

  it("lists the paths that a removal deletes", () => {
    const message = removalMessage("develop", ["codex"], {
      name: "develop",
      harnesses: [{ harness: "codex", path: ".agents/skills/develop", installed: true }],
    });

    expect(message).toContain("codex: .agents/skills/develop");
    expect(message).toContain("Removal deletes local changes");
  });

  it("needs a harness, and asks before a removal", async () => {
    const e = env();

    await expect(submitSkillForm(e, { codex: false, cursor: false })).rejects.toBeInstanceOf(ValidationError);
    await submitSkillForm(e, { codex: true, cursor: false });

    expect(e.setTargets).toHaveBeenCalledWith(["codex"]);
    expect(e.setBusy).not.toHaveBeenCalled();
  });
});
