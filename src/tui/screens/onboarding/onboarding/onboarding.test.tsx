import { cleanup } from "ink-testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getProject } from "../../../../services/project/project.js";
import { useTempDir } from "../../../../services/test-project/test-project.js";
import { keys, renderTui, settle } from "../../../testing/index.js";
import { Onboarding } from "./onboarding.js";

afterEach(cleanup);

describe("Onboarding", () => {
  const dir = useTempDir();

  async function open(onCreated = vi.fn()) {
    const tui = await renderTui(<Onboarding ctx={{ cwd: dir.path }} onCreated={onCreated} onHints={() => {}} />);
    // The options load from disk. The first step takes no keys before they load.
    await vi.waitFor(() => expect(tui.frame()).toContain("Use defaults"));
    await tui.press();
    return tui;
  }

  async function step(tui: Awaited<ReturnType<typeof open>>, ...inputs: string[]) {
    await tui.press(...inputs);
    await settle(50);
    await tui.press();
  }

  it("goes from the defaults to the summary and back", async () => {
    const tui = await open();
    await step(tui, keys.enter);
    expect(tui.frame()).toContain("Summary");
    expect(tui.frame()).not.toContain("Project name and key");
    expect(tui.frame()).toContain("develop (required)");
    expect(tui.frame()).not.toContain("Warning:");
    await step(tui, keys.escape);
    expect(tui.frame()).toContain("Use defaults");
  });

  it("walks the customize steps and creates the choices", async () => {
    const onCreated = vi.fn();
    const tui = await open(onCreated);
    await step(tui, keys.down, keys.enter);
    expect(tui.frame()).toContain("Project name and key");

    await step(tui, keys.enter);
    expect(tui.frame()).toContain("Default Stages have a prompt.");
    expect(tui.frame()).toContain("Backlog (always enabled)");
    expect(tui.frame()).toContain("Done (always enabled)");
    // Space does not change Backlog. Drop In Refinement and In Development, and add a custom Stage.
    await tui.press(keys.space, keys.down, keys.space, keys.down, keys.space, "n");
    await tui.type("QA");
    await step(tui, keys.enter);
    expect(tui.frame()).toContain("[x] QA");

    await step(tui, keys.enter);
    expect(tui.frame()).toContain("Agent skills");
    expect(tui.frame()).toMatch(/review \(required\)/);
    expect(tui.frame()).not.toMatch(/develop \(required\)/);
    expect(tui.frame()).toContain("factory (required to use the factory)");
    // Drop develop, factory and refine; review stays.
    await step(tui, keys.space, keys.down, keys.space, keys.down, keys.space, keys.enter);
    expect(tui.frame()).toContain("Harnesses");

    // Keep only codex.
    await step(
      tui,
      keys.space,
      keys.down,
      keys.down,
      keys.space,
      keys.down,
      keys.space,
      keys.down,
      keys.space,
      keys.enter,
    );
    expect(tui.frame()).toContain("Summary");
    expect(tui.frame()).toContain('companion skill "factory"');
    await step(tui, keys.enter);
    await settle(200);
    expect(onCreated).toHaveBeenCalled();
    const project = await getProject({ cwd: dir.path });
    expect(project.stages.map((stage) => stage.key)).toEqual(["BACKLOG", "IN_REVIEW", "QA", "DONE"]);
    expect(project.skills).toEqual([{ name: "review", harnesses: ["codex"] }]);
  });
});
