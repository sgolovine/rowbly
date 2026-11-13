import { describe, expect, it, vi } from "vitest";
import { ValidationError } from "../../../../services/errors/errors.js";
import { createToastStore } from "../../../hooks/index.js";
import { removalMessage, type SkillActionEnv, skillResultText, submitSkillForm } from "./skill-action.js";

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
  it("names the result of each harness", () => {
    expect(
      skillResultText("develop", {
        harnesses: [
          { harness: "codex", path: "a", status: "shared" },
          { harness: "cursor", path: "b", status: "missing" },
          { harness: "claude-code", path: "c", status: "removed" },
        ],
      } as never),
    ).toBe("develop: codex: shared (folder kept); cursor: already missing; claude-code: removed");
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
