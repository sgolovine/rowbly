import { Text } from "ink";
import { cleanup } from "ink-testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useTestProject } from "../../../../services/test-project/test-project.js";
import type { ServiceContext } from "../../../../services/workspace/workspace.js";
import { renderTui } from "../../../testing/index.js";
import { useGitSection } from "./use-git-section.js";

afterEach(cleanup);

function Probe({ ctx }: { ctx: ServiceContext }) {
  const model = useGitSection({ ctx, onChange: () => {} });

  return (
    <Text>
      idle={String(model.idle)} task={model.task ?? "none"} push={String(model.env.settings.data?.git?.push)}
    </Text>
  );
}

describe("useGitSection", () => {
  const project = useTestProject();

  it("reads the settings, then opens a form with its key", async () => {
    const tui = await renderTui(<Probe ctx={project.ctx} />);

    await vi.waitFor(async () => {
      await tui.press();
      expect(tui.frame()).toContain("idle=true task=none push=false");
    });
    await tui.press("i");

    expect(tui.frame()).toContain("idle=false task=interval");
  });
});
