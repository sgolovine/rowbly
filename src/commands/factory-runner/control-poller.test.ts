import { describe, expect, it, vi } from "vitest";
import { publishCommand, readReceipt } from "../../services/factory-control/factory-control.js";
import { prepareRuntime } from "../../services/runtime-files/runtime-files.js";
import { useTestProject } from "../../services/test-project/test-project.js";
import { type ControlTarget, createControlPoller, pollControl, settledControl } from "./control-poller.js";

function fakeManager() {
  return {
    shutdown: vi.fn(async () => {}),
    cancelWorker: vi.fn(async () => {}),
    releaseWorker: vi.fn(async () => {}),
    resumeWorker: vi.fn(async () => {}),
    steerWorker: vi.fn(async () => {}),
    dismissAttention: vi.fn(async () => {}),
    releaseStory: vi.fn(async () => ({ storyId: "TST-1", released: true })),
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

  it("gives a release with its Thread and run to the manager", async () => {
    await prepareRuntime(project.paths);
    const manager = fakeManager();
    const release = await publishCommand(project.paths, {
      targetOwnerToken: "owner",
      type: "release",
      threadId: "thread",
      expectedRunId: "run",
    });
    const noRun = await publishCommand(project.paths, { targetOwnerToken: "owner", type: "release", threadId: "x" });
    const poller = createControlPoller(project.paths, "owner", manager as unknown as ControlTarget);

    pollControl(poller);
    await settledControl(poller);

    expect(manager.releaseWorker).toHaveBeenCalledTimes(1);
    expect(manager.releaseWorker).toHaveBeenCalledWith("thread", "run");
    expect(manager.cancelWorker).not.toHaveBeenCalled();
    expect((await readReceipt(project.paths, release.id))?.status).toBe("completed");
    expect((await readReceipt(project.paths, noRun.id))?.status).toBe("rejected");
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

  it("gives a Story release with its Story ID to the manager, and rejects a Story release without a Story ID", async () => {
    await prepareRuntime(project.paths);
    const manager = fakeManager();
    const release = await publishCommand(project.paths, {
      targetOwnerToken: "owner",
      type: "release-story",
      storyId: "TST-1",
    });
    const missing = await publishCommand(project.paths, { targetOwnerToken: "owner", type: "release-story" });
    const poller = createControlPoller(project.paths, "owner", manager as unknown as ControlTarget);

    pollControl(poller);
    await settledControl(poller);

    expect(manager.releaseStory).toHaveBeenCalledExactlyOnceWith("TST-1");
    expect((await readReceipt(project.paths, release.id))?.status).toBe("completed");
    expect(await readReceipt(project.paths, missing.id)).toMatchObject({
      status: "rejected",
      error: { message: "A Story ID of 1 to 128 characters is necessary" },
    });
  });

  it("gives a steer with its Thread, run and message to the manager", async () => {
    await prepareRuntime(project.paths);
    const manager = fakeManager();
    const steer = await publishCommand(project.paths, {
      targetOwnerToken: "owner",
      type: "steer",
      threadId: "thread",
      expectedRunId: "run",
      message: "Use the new API",
    });
    const noRun = await publishCommand(project.paths, {
      targetOwnerToken: "owner",
      type: "steer",
      threadId: "thread",
      message: "Use the new API",
    });
    const poller = createControlPoller(project.paths, "owner", manager as unknown as ControlTarget);

    pollControl(poller);
    await settledControl(poller);

    expect(manager.steerWorker).toHaveBeenCalledExactlyOnceWith("thread", "run", "Use the new API");
    expect((await readReceipt(project.paths, steer.id))?.status).toBe("completed");
    expect(await readReceipt(project.paths, noRun.id)).toMatchObject({
      status: "rejected",
      error: { message: "Thread and run IDs are necessary" },
    });
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
