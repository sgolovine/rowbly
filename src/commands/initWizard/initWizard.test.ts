import { beforeEach, describe, expect, it, vi } from "vitest";
import { useTempDir } from "../../services/testProject/testProject.js";

const prompts = vi.hoisted(() => ({
  cancel: vi.fn(),
  confirm: vi.fn(),
  intro: vi.fn(),
  isCancel: vi.fn((value: unknown) => typeof value === "symbol"),
  multiselect: vi.fn(),
  note: vi.fn(),
  select: vi.fn(),
  text: vi.fn(),
}));
vi.mock("@clack/prompts", () => prompts);

const { askOnboarding } = await import("./initWizard.js");

describe("askOnboarding", () => {
  const dir = useTempDir();

  beforeEach(() => {
    vi.clearAllMocks();
    prompts.confirm.mockResolvedValue(true);
  });

  it("goes to the summary with the defaults", async () => {
    prompts.select.mockResolvedValue("defaults");
    expect(await askOnboarding({ cwd: dir.path })).toEqual({});
    expect(prompts.text).not.toHaveBeenCalled();
    expect(prompts.note).toHaveBeenCalledWith(expect.stringContaining("develop (required)"), "Summary");
    expect(prompts.note).toHaveBeenCalledWith(
      expect.stringContaining("rowbly install-skill"),
      "Where to edit this later",
    );
  });

  it("asks each step, marks required skills and adds them back", async () => {
    prompts.select.mockResolvedValue("customize");
    prompts.text.mockResolvedValueOnce("My App").mockResolvedValueOnce("APP").mockResolvedValueOnce("QA");
    prompts.multiselect
      .mockResolvedValueOnce(["Backlog", "In Review", "Done"])
      .mockResolvedValueOnce(["factory"])
      .mockResolvedValueOnce(["codex"]);
    expect(await askOnboarding({ cwd: dir.path })).toEqual({
      name: "My App",
      key: "APP",
      stages: ["Backlog", "In Review", "QA", "Done"],
      skills: ["review", "factory"],
      harnesses: ["codex"],
    });
    expect(prompts.multiselect.mock.calls[1]?.[0].options).toContainEqual({
      value: "review",
      label: "review (required)",
      hint: "always installed",
    });
  });

  it("gives null when the user cancels", async () => {
    prompts.select.mockResolvedValue(Symbol("cancel"));
    expect(await askOnboarding({ cwd: dir.path })).toBeNull();
    expect(prompts.cancel).toHaveBeenCalled();
  });

  it("gives null when the user does not confirm the summary", async () => {
    prompts.select.mockResolvedValue("defaults");
    prompts.confirm.mockResolvedValue(false);
    expect(await askOnboarding({ cwd: dir.path })).toBeNull();
  });
});
