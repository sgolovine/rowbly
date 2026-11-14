import type { Key } from "ink";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConflictError } from "../../../../services/errors/errors.js";
import * as factory from "../../../../services/factory/factory.js";
import type { Story } from "../../../../services/story/story.js";
import type { ThreadRecord } from "../../../../services/thread/thread.js";
import { createToastStore } from "../../../hooks/index.js";
import type { FactoryProblem } from "../factory-status.js";
import { type AttentionEnv, dismissProblem, handleProblemKey } from "./factory-attention-actions.js";

vi.mock("../../../../services/factory/factory.js", async (original) => ({
  ...(await original<typeof import("../../../../services/factory/factory.js")>()),
  dismissFactoryAttention: vi.fn(async () => ({ status: "completed" })),
}));

afterEach(() => {
  vi.clearAllMocks();
});

const commit: FactoryProblem = {
  key: "attention:commit",
  kind: "attention",
  title: "commit",
  text: "ROW-01: failed",
  message: "failed",
  attentionKey: "commit",
  storyId: "ROW-01",
  dismissible: true,
};

function env(overrides: Partial<AttentionEnv> = {}): AttentionEnv {
  return {
    ctx: {},
    toast: createToastStore(),
    problem: commit,
    story: { id: "ROW-01" } as Story,
    thread: { id: "th" } as ThreadRecord,
    dismissing: { current: false },
    setBusy: vi.fn(),
    setProblemKey: vi.fn(),
    onOpenStory: vi.fn(),
    onOpenThread: vi.fn(),
    ...overrides,
  };
}

const key = (overrides: Partial<Key> = {}) => ({ ...overrides }) as Key;

describe("factoryAttentionActions", () => {
  it("opens the Story with o and the Thread with t", () => {
    const e = env();

    handleProblemKey(e, "o", key());
    handleProblemKey(e, "t", key());
    handleProblemKey(e, "o", key({ ctrl: true }));

    expect(e.onOpenStory).toHaveBeenCalledExactlyOnceWith(e.story);
    expect(e.onOpenThread).toHaveBeenCalledExactlyOnceWith(e.thread);
  });

  it("dismisses an attention entry, and goes back to the list after the receipt", async () => {
    const e = env();

    await dismissProblem(e);

    expect(factory.dismissFactoryAttention).toHaveBeenCalledWith("commit", {}, {});
    expect(e.toast.list().map((t) => t.message)).toEqual(["Dismissed the warning"]);
    expect(e.setProblemKey).toHaveBeenCalledOnce();
    expect(e.setBusy).toHaveBeenLastCalledWith(false);
  });

  it("shows an error and keeps the warning when the dismiss fails", async () => {
    vi.mocked(factory.dismissFactoryAttention).mockRejectedValueOnce(new ConflictError("Factory is not running"));
    const e = env();

    await dismissProblem(e);

    expect(e.toast.list().map((t) => [t.kind, t.message])).toEqual([["error", "Factory is not running"]]);
    expect(e.setProblemKey).not.toHaveBeenCalled();
  });

  it("sends no dismiss for a warning that is not an attention entry", async () => {
    const e = env({
      problem: { key: "heartbeat", kind: "heartbeat", title: "Heartbeat", text: "x", message: "x", dismissible: false },
    });

    handleProblemKey(e, "d", key());
    await dismissProblem(e);

    expect(factory.dismissFactoryAttention).not.toHaveBeenCalled();
  });
});
