import { cleanup } from "ink-testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useTestProject } from "../../../../services/test-project/test-project.js";
import { createThread } from "../../../../services/thread/thread.js";
import { renderTui } from "../../../testing/index.js";
import { FactorySupervisor } from "./factory-supervisor.js";

afterEach(cleanup);

describe("FactorySupervisor", () => {
  const project = useTestProject();

  it("shows the conversation of a supervisor that has no history yet", async () => {
    const thread = await createThread({ role: "supervisor", cwd: project.paths.root, ownerToken: "t" }, project.ctx);
    const tui = await renderTui(
      <FactorySupervisor
        ctx={project.ctx}
        threadId={thread.id}
        live={false}
        active
        layout={{ width: 80, height: 24 }}
      />,
    );

    await vi.waitFor(async () => {
      await tui.press();
      expect(tui.frame()).toContain("No conversation yet");
    });
  });
});
