import { cleanup } from "ink-testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FactoryStatus } from "../../../../services/factory/factory.js";
import * as factory from "../../../../services/factory/factory.js";
import { useTestProject } from "../../../../services/testProject/testProject.js";
import { createThread } from "../../../../services/thread/thread.js";
import { keys, renderTui, settle } from "../../../testing/index.js";
import { FactoryModal } from "./FactoryModal.js";

vi.mock("../../../../services/factory/factory.js", async (original) => ({
  ...(await original<typeof import("../../../../services/factory/factory.js")>()),
  startFactory: vi.fn(async () => ({})),
  stopFactory: vi.fn(async () => ({ phase: "stopped" })),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const launch = { executable: "/usr/bin/node", execArgv: [], entry: "/opt/rowbly/cli.js" };
const running = {
  version: 1,
  phase: "ready",
  liveness: "alive",
  responsive: true,
  owner: { version: 1, token: "t", pid: 1, hostname: "h", startedAt: "2026-11-12T10:00:00.000Z" },
  workers: { running: 2, pending: 1, waiting: 0, limit: 4 },
  attention: [["commit", { text: "Canonical commit: failed", storyId: "ROW-01" }]],
  providers: { anthropic: { reason: "quota" } },
  queue: [
    { story: "ROW-02", stage: "DEVELOP", action: "skip", reason: "worker limit" },
    { story: "ROW-03", stage: "REVIEW", action: "skip", reason: "parked" },
  ],
} as unknown as FactoryStatus;

describe("FactoryModal", () => {
  const project = useTestProject();

  async function open(status: FactoryStatus, checkProvider = async () => false) {
    const onClose = vi.fn();
    const tui = await renderTui(
      <FactoryModal
        ctx={project.ctx}
        status={status}
        stages={{ DEVELOP: "Develop" }}
        launch={launch}
        onClose={onClose}
        checkProvider={checkProvider}
      />,
    );
    await settle(50);
    await tui.press();
    return { tui, onClose };
  }

  it("explains a stopped factory without a provider, and starts it with s", async () => {
    const { tui, onClose } = await open({ version: 1, phase: "stopped" });
    expect(tui.frame()).toContain("Stopped");
    expect(tui.frame()).toContain("limit 4");
    expect(tui.frame()).toContain("No AI provider is signed in");
    expect(tui.frame()).toMatch(/s start/);
    await tui.press("s");
    await settle(20);
    expect(factory.startFactory).toHaveBeenCalledWith({ launch }, project.ctx);
    expect(tui.toasts.list().map((t) => t.message)).toContain("Started the factory");
    await tui.press("\u001B");
    expect(onClose).toHaveBeenCalled();
  });

  it("shows the counts, the problems and the queue of a running factory, and asks before x stops it", async () => {
    const { tui } = await open(running, async () => true);
    expect(tui.frame()).toContain("Running");
    expect(tui.frame()).toContain("2 running · 1 pending · limit 4");
    expect(tui.frame()).toContain("! ROW-01: Canonical commit: failed");
    expect(tui.frame()).toContain("! Provider anthropic is paused (quota).");
    expect(tui.frame()).toContain("ROW-02 Develop · waiting for a worker slot");
    expect(tui.frame()).toContain("ROW-03 REVIEW · parked");
    expect(tui.frame()).not.toContain("No AI provider");
    await tui.press("s");
    expect(factory.startFactory).not.toHaveBeenCalled();
    await tui.press("x");
    expect(tui.frame()).toContain("Stop the factory?");
    await tui.press("y");
    await settle(20);
    expect(factory.stopFactory).toHaveBeenCalledOnce();
  });

  it("starts and stops with a click on the Buttons, as the keys do", async () => {
    const { tui } = await open({ version: 1, phase: "stopped" });
    await tui.click("Start");
    await settle(20);
    expect(factory.startFactory).toHaveBeenCalledOnce();
    await tui.rerender(
      <FactoryModal
        ctx={project.ctx}
        status={running}
        launch={launch}
        onClose={() => {}}
        checkProvider={async () => true}
      />,
    );
    await tui.click("Stop");
    expect(tui.frame()).toContain("Stop the factory?");
  });

  it("shows the supervisor conversation with enter, goes back with esc, and opens AI settings with a", async () => {
    const supervisor = await createThread(
      { role: "supervisor", cwd: project.paths.root, ownerToken: "t" },
      project.ctx,
    );
    const onAiSettings = vi.fn();
    const tui = await renderTui(
      <FactoryModal
        ctx={project.ctx}
        status={{ ...running, supervisorThreadId: supervisor.id }}
        launch={launch}
        onClose={() => {}}
        onAiSettings={onAiSettings}
        checkProvider={async () => true}
      />,
    );
    await settle(50);
    await tui.press(keys.enter);
    await vi.waitFor(async () => {
      await tui.press();
      expect(tui.frame()).toContain("Factory › Supervisor");
      expect(tui.frame()).toContain("No conversation yet");
    });
    await tui.press(keys.escape);
    expect(tui.frame()).toContain("2 running · 1 pending");
    await tui.press("a");
    expect(onAiSettings).toHaveBeenCalledOnce();
  });

  it("asks a stopped factory without a provider to sign in with a", async () => {
    const tui = await renderTui(
      <FactoryModal
        ctx={project.ctx}
        status={{ version: 1, phase: "stopped" }}
        launch={launch}
        onClose={() => {}}
        onAiSettings={() => {}}
        checkProvider={async () => false}
      />,
    );
    await settle(50);
    await tui.press();
    expect(tui.frame()).toContain("Press a to sign in");
  });
});
