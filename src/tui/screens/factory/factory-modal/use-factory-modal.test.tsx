import { Text } from "ink";
import { cleanup } from "ink-testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FactoryStatus } from "../../../../services/factory/factory.js";
import { useTestProject } from "../../../../services/test-project/test-project.js";
import { createThread } from "../../../../services/thread/thread.js";
import type { ServiceContext } from "../../../../services/workspace/workspace.js";
import { keys, renderTui } from "../../../testing/index.js";
import { useFactoryModal } from "./use-factory-modal.js";

afterEach(cleanup);

function Probe({ ctx, status, onClose }: { ctx: ServiceContext; status: FactoryStatus; onClose: () => void }) {
  const model = useFactoryModal({
    ctx,
    status,
    launch: undefined,
    onClose,
    onAiSettings: undefined,
    checkProvider: async () => true,
  });

  return (
    <Text>
      view={model.view} start={String(model.can.start)} inspect={String(model.can.inspect)} id=
      {model.supervisorId ?? "none"}
    </Text>
  );
}

describe("useFactoryModal", () => {
  const project = useTestProject();

  it("cannot start without a launch, and closes with esc", async () => {
    const onClose = vi.fn();
    const tui = await renderTui(
      <Probe ctx={project.ctx} status={{ version: 1, phase: "stopped" }} onClose={onClose} />,
    );

    expect(tui.frame()).toContain("view=main start=false inspect=false id=none");

    await tui.press(keys.escape);

    expect(onClose).toHaveBeenCalledOnce();
  });

  it("selects the last supervisor Thread, shows it with enter and goes back with esc", async () => {
    const thread = await createThread({ role: "supervisor", cwd: project.paths.root, ownerToken: "t" }, project.ctx);
    const onClose = vi.fn();
    const tui = await renderTui(
      <Probe ctx={project.ctx} status={{ version: 1, phase: "stopped" }} onClose={onClose} />,
    );

    await vi.waitFor(async () => {
      await tui.press();
      expect(tui.frame()).toContain(`inspect=true id=${thread.id}`);
    });
    await tui.press(keys.enter);

    expect(tui.frame()).toContain("view=supervisor");

    await tui.press(keys.escape);

    expect(tui.frame()).toContain("view=main");
    expect(onClose).not.toHaveBeenCalled();

    await tui.press("h");

    expect(tui.frame()).toContain("view=history");
  });
});
