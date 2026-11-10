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

  it("shows the plan and where to edit it, and creates the Project with enter", async () => {
    const onCreated = vi.fn();
    const ctx = { cwd: dir.path };
    const tui = await renderTui(
      <OnboardingSummary
        {...props}
        ctx={ctx}
        input={{ name: "App", stages: ["Backlog", "QA"], skills: [] }}
        onCreated={onCreated}
      />,
    );
    await settle(50);
    await tui.press();
    expect(tui.frame()).toContain("Backlog → QA → Done");
    expect(tui.frame()).toContain("Where to edit this later");
    expect(tui.frame()).toContain(".rowbly/stages/<KEY>.md");
    await tui.press(keys.enter);
    await settle(100);
    expect(onCreated).toHaveBeenCalled();
    expect((await getProject(ctx)).projectName).toBe("App");
  });

  it("goes back with esc", async () => {
    const onBack = vi.fn();
    const tui = await renderTui(<OnboardingSummary {...props} ctx={{ cwd: dir.path }} input={{}} onBack={onBack} />);
    await settle(50);
    await tui.press(keys.escape);
    expect(onBack).toHaveBeenCalled();
  });
});
