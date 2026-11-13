import type { Key } from "ink";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as factory from "../../../../services/factory/factory.js";
import type { ThreadRecord } from "../../../../services/thread/thread.js";
import { createToastStore } from "../../../hooks/index.js";
import {
  clickRow,
  confirmInterrupt,
  handleListKey,
  handleThreadKey,
  type ThreadsTabEnv,
} from "./threads-tab-actions.js";

vi.mock("../../../../services/factory/factory.js", async (original) => ({
  ...(await original<typeof import("../../../../services/factory/factory.js")>()),
  sendFactoryCommand: vi.fn(async () => ({ status: "completed" })),
}));

afterEach(() => {
  vi.clearAllMocks();
});

const thread: ThreadRecord = {
  version: 1,
  id: "t",
  revision: 2,
  role: "worker",
  storyId: "ROW-01",
  stage: "DEVELOP",
  attemptNumber: 1,
  status: "running",
  createdAt: "2026-11-12T10:00:00.000Z",
  session: { id: "t", file: null },
  cwd: "/p",
  runs: [{ id: "r", ownerToken: "o", createdAt: "2026-11-12T10:00:00.000Z", status: "running" }],
  resumable: false,
};

const noKey = {} as Key;

function env(overrides: Partial<ThreadsTabEnv> = {}): ThreadsTabEnv {
  return {
    ctx: { cwd: "/p" },
    storyId: "ROW-01",
    stages: { DEVELOP: "Develop" },
    toast: createToastStore(),
    current: thread,
    cursor: 0,
    sending: { current: false },
    refresh: vi.fn(),
    setFocus: vi.fn(),
    setConfirm: vi.fn(),
    setCursor: vi.fn(),
    ...overrides,
  };
}

describe("handleListKey", () => {
  it("opens the selected thread with enter or tab", () => {
    const tab = env();
    handleListKey(tab, "", { ...noKey, return: true });
    handleListKey(tab, "", { ...noKey, tab: true });
    expect(tab.setFocus).toHaveBeenCalledTimes(2);
    expect(tab.setFocus).toHaveBeenCalledWith("thread");
  });

  it("asks before it interrupts an active thread, and ignores ctrl keys", () => {
    const tab = env();
    handleListKey(tab, "x", { ...noKey, ctrl: true });
    expect(tab.setConfirm).not.toHaveBeenCalled();
    handleListKey(tab, "x", noKey);
    expect(tab.setConfirm).toHaveBeenCalledWith(thread);
  });
});

describe("handleThreadKey", () => {
  it("goes back to the list with tab, and does not resume a running thread", () => {
    const tab = env();
    handleThreadKey(tab, "", { ...noKey, tab: true });
    expect(tab.setFocus).toHaveBeenCalledWith("list");
    handleThreadKey(tab, "r", noKey);
    expect(factory.sendFactoryCommand).not.toHaveBeenCalled();
  });
});

describe("clickRow", () => {
  it("opens the selected row, and selects another row", () => {
    const tab = env({ cursor: 1 });
    clickRow(tab, 1);
    expect(tab.setFocus).toHaveBeenLastCalledWith("thread");
    clickRow(tab, 0);
    expect(tab.setCursor).toHaveBeenCalledWith(0);
    expect(tab.setFocus).toHaveBeenLastCalledWith("list");
  });
});

describe("confirmInterrupt", () => {
  it("closes the dialog, sends the command and shows the result", async () => {
    const tab = env();
    confirmInterrupt(tab, thread);
    expect(tab.setConfirm).toHaveBeenCalledWith(null);
    await vi.waitFor(() => expect(tab.refresh).toHaveBeenCalledOnce());
    expect(factory.sendFactoryCommand).toHaveBeenCalledWith("cancel", { threadId: "t" }, tab.ctx);
    expect(tab.toast.list().map((toast) => toast.message)).toEqual(["Interrupted ROW-01 #1 Develop"]);
  });

  it("sends no second command while the first command waits", () => {
    const tab = env({ sending: { current: true } });
    confirmInterrupt(tab, thread);
    expect(factory.sendFactoryCommand).not.toHaveBeenCalled();
  });
});
