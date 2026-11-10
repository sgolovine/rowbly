import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { cleanup } from "ink-testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getProject } from "../../../../services/project/project.js";
import { useTempDir } from "../../../../services/testProject/testProject.js";
import { keys, renderTui, settle } from "../../../testing/index.js";
import { OnboardingSummary } from "./OnboardingSummary.js";

afterEach(cleanup);

describe("OnboardingSummary", () => {
  const dir = useTempDir();
  const props = { onBack: () => {}, onCreated: () => {}, onHints: () => {} };

  it.each([{}, { name: "App", stages: ["Backlog", "QA"], skills: [] }])(
    "shows the plan and creates the Project with enter for %j",
    async (input) => {
      const onCreated = vi.fn();
      const ctx = { cwd: dir.path };
      const tui = await renderTui(<OnboardingSummary {...props} ctx={ctx} input={input} onCreated={onCreated} />);
      await settle(50);
      await tui.press();
      expect(tui.frame()).toContain(input.stages ? "Backlog → QA → Done" : "Backlog → In Refinement");
      expect(tui.frame()).toContain("Where to edit this later");
      expect(tui.frame()).toContain(".rowbly/stages/<KEY>.md");
      await tui.press(keys.enter);
      await settle(100);
      expect(onCreated).toHaveBeenCalled();
      expect((await getProject(ctx)).projectName).toBe(input.name ?? dir.path.split("/").at(-1));
      expect(await readFile(join(dir.path, ".rowbly/ROWBLY.md"), "utf8")).toBe("# ROWBLY INSTRUCTIONS\n");
    },
  );

  it("goes back with esc", async () => {
    const onBack = vi.fn();
    const tui = await renderTui(<OnboardingSummary {...props} ctx={{ cwd: dir.path }} input={{}} onBack={onBack} />);
    await settle(50);
    await tui.press(keys.escape);
    expect(onBack).toHaveBeenCalled();
  });
});
