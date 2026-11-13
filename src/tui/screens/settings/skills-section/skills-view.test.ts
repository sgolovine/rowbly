import { describe, expect, it, vi } from "vitest";
import { type SkillsEnv, skillNames, skillSaved, skillsHints, skillsKey } from "./skills-view.js";

function env(overrides: Partial<SkillsEnv> = {}): SkillsEnv {
  return {
    list: { reload: vi.fn(), refresh: vi.fn(), loading: false } as unknown as SkillsEnv["list"],
    canInstall: true,
    canRemove: false,
    setMode: vi.fn(),
    onChange: vi.fn(),
    ...overrides,
  };
}

describe("skillsView", () => {
  it("lists each bundled or tracked skill once, in order", () => {
    expect(
      skillNames({
        bundled: ["refine", "develop"],
        tracked: [
          { name: "old", harnesses: [] },
          { name: "develop", harnesses: [] },
        ],
      }),
    ).toEqual(["develop", "old", "refine"]);
    expect(skillNames(undefined)).toEqual([]);
  });

  it("offers install or uninstall only when they work", () => {
    expect(skillsHints(false, true, true)).toEqual([]);
    expect(skillsHints(true, true, false).map((h) => h.key)).toEqual(["↑/↓", "/", "i", "r"]);
  });

  it("routes the keys and reads the skills again after a save", () => {
    const e = env();

    skillsKey(e, "i");
    skillsKey(e, "d");
    skillsKey(e, "r");
    skillSaved(e);

    expect(e.setMode).toHaveBeenNthCalledWith(1, "install");
    expect(e.setMode).toHaveBeenNthCalledWith(2, null);
    expect(e.list.reload).toHaveBeenCalledTimes(2);
    expect(e.onChange).toHaveBeenCalledOnce();
  });
});
