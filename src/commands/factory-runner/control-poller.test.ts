import { describe, expect, it, vi } from "vitest";
import { publishCommand, readReceipt } from "../../services/factory-control/factory-control.js";
import { prepareRuntime } from "../../services/runtime-files/runtime-files.js";
import { useTestProject } from "../../services/test-project/test-project.js";
import { type ControlTarget, createControlPoller, pollControl, settledControl } from "./control-poller.js";

function fakeManager() {
  return {
    shutdown: vi.fn(async () => {}),
    cancelWorker: vi.fn(async () => {}),
    resumeWorker: vi.fn(async () => {}),
    dismissAttention: vi.fn(async () => {}),
  };
}

describe("control poller", () => {
  const project = useTestProject();

  it("gives each command of the owner to the manager and writes a receipt", async () => {
    await prepareRuntime(project.paths);
    const manager = fakeManager();
    const stop = await publishCommand(project.paths, { targetOwnerToken: "owner", type: "stop" });
    const cancel = await publishCommand(project.paths, {
      targetOwnerToken: "owner",
      type: "cancel",
      threadId: "thread",
      expectedRunId: "run",
    });
    const resume = await publishCommand(project.paths, { targetOwnerToken: "owner", type: "resume" });
    const poller = createControlPoller(project.paths, "owner", manager as unknown as ControlTarget);

    pollControl(poller);
    await settledControl(poller);

    expect(manager.shutdown).toHaveBeenCalledTimes(1);
    expect(manager.cancelWorker).toHaveBeenCalledWith("thread", "run");
    expect(manager.resumeWorker).not.toHaveBeenCalled();
    expect((await readReceipt(project.paths, stop.id))?.status).toBe("completed");
    expect((await readReceipt(project.paths, cancel.id))?.status).toBe("completed");
    expect(await readReceipt(project.paths, resume.id)).toMatchObject({
      status: "rejected",
      error: { message: "Thread and run IDs are necessary" },
    });
  });

  it("gives a dismiss with its attention key to the manager", async () => {
    await prepareRuntime(project.paths);
    const manager = fakeManager();
    const dismiss = await publishCommand(project.paths, {
      targetOwnerToken: "owner",
      type: "dismiss",
      attentionKey: "commit",
    });
    const missing = await publishCommand(project.paths, { targetOwnerToken: "owner", type: "dismiss" });
    const poller = createControlPoller(project.paths, "owner", manager as unknown as ControlTarget);

    pollControl(poller);
    await settledControl(poller);

    expect(manager.dismissAttention).toHaveBeenCalledTimes(1);
    expect(manager.dismissAttention).toHaveBeenCalledWith("commit");
    expect((await readReceipt(project.paths, dismiss.id))?.status).toBe("completed");
    expect((await readReceipt(project.paths, missing.id))?.status).toBe("rejected");
  });

  it("starts no second scan while one waits, and polls again after it ends", async () => {
    await prepareRuntime(project.paths);
    const manager = fakeManager();
    const poller = createControlPoller(project.paths, "owner", manager as unknown as ControlTarget);

    pollControl(poller);
    const first = settledControl(poller);
    pollControl(poller);

    expect(settledControl(poller)).toBe(first);
    await first;
    expect(poller.state.current.polling).toBe(false);

    await publishCommand(project.paths, { targetOwnerToken: "owner", type: "stop" });
    pollControl(poller);
    await settledControl(poller);
    expect(manager.shutdown).toHaveBeenCalledTimes(1);
  });

  it("reports a failed scan and keeps the queue usable", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const poller = createControlPoller(project.paths, "owner", fakeManager() as unknown as ControlTarget);

    // Without `prepareRuntime`, the control folder is missing, so the scan fails.
    pollControl(poller);
    await settledControl(poller);

    expect(errors).toHaveBeenCalledTimes(1);
    expect(poller.state.current.polling).toBe(false);
    errors.mockRestore();
  });
});
