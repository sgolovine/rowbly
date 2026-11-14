import { cleanup } from "ink-testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthRuntime } from "../../../../services/agent-auth/agent-auth.js";
import { updateProject } from "../../../../services/project/project.js";
import { createSpec } from "../../../../services/spec/spec.js";
import { createStory } from "../../../../services/story/story.js";
import { useTestProject } from "../../../../services/test-project/test-project.js";
import { renderTui } from "../../../testing/index.js";
import { StoryTabPanes, type StoryTabReports } from "./story-tab-panes.js";

vi.mock("../../../../services/agent-auth/agent-auth.js", async (original) => ({
  ...(await original<typeof import("../../../../services/agent-auth/agent-auth.js")>()),
  authRuntime: vi.fn(async () => ({ getAvailable: async () => [] }) as unknown as AuthRuntime),
}));

afterEach(cleanup);

function reports(): StoryTabReports {
  return {
    setSpecCount: vi.fn(),
    setSpecEditing: vi.fn(),
    setSpecHints: vi.fn(),
    setThreadCount: vi.fn(),
    setThreadViewing: vi.fn(),
    setThreadHints: vi.fn(),
    setAttachmentHints: vi.fn(),
    setAttachmentTask: vi.fn(),
    setModelHints: vi.fn(),
    setModelTask: vi.fn(),
  };
}

describe("StoryTabPanes", () => {
  const project = useTestProject();

  beforeEach(async () => {
    await updateProject({ features: { specs: true } }, project.ctx);
    await createStory({ title: "Login" }, project.ctx);
    await createSpec({ title: "API", stories: ["ROW-01"], body: "The API text" }, project.ctx);
  });

  it("shows only the tab on the screen, and keeps the other tabs mounted", async () => {
    const calls = reports();
    const tui = await renderTui(
      <StoryTabPanes
        ctx={project.ctx}
        storyId="ROW-01"
        specs
        shown="specs"
        open
        specsLayout={{ width: 100 }}
        generalLayout={{ width: 96 }}
        reports={calls}
      />,
    );
    await vi.waitFor(async () => {
      await tui.press();
      expect(tui.frame()).toContain("The API text");
      expect(calls.setSpecCount).toHaveBeenLastCalledWith(1);
    });
    expect(tui.frame()).not.toContain("No attachments");
    expect(tui.frame()).not.toContain("A Story override");
  });

  it("shows the Models tab with one row for each Stage, and reports its hints", async () => {
    const calls = reports();
    const tui = await renderTui(
      <StoryTabPanes
        ctx={project.ctx}
        storyId="ROW-01"
        specs
        shown="models"
        open
        specsLayout={{ width: 100 }}
        generalLayout={{ width: 96 }}
        reports={calls}
      />,
    );
    await vi.waitFor(async () => {
      await tui.press();
      expect(tui.frame()).toMatch(/● Backlog\s+Worker model: Pi default/);
      expect(calls.setModelHints).toHaveBeenLastCalledWith([
        { key: "↑/↓", description: "select Stage" },
        { key: "enter", description: "change model" },
      ]);
    });
    expect(tui.frame()).not.toContain("The API text");
  });
});
