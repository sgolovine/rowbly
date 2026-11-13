import { describe, expect, it, vi } from "vitest";
import type { Conversation, ConversationEntry, ConversationPage } from "../../../services/conversation/conversation.js";
import type { ToastStore } from "../../hooks/index.js";
import { loadNewer, loadOlder, type ReadEnv, readExclusive } from "./conversation-reads.js";
import type { ConversationWindow } from "./conversation-window.js";

function entries(from: number, count: number): ConversationEntry[] {
  return Array.from({ length: count }, (_, i) => ({ id: `m${from + i}`, type: "message", text: "" }));
}

function page(list: ConversationEntry[], more: Partial<ConversationPage> = {}): ConversationPage {
  return { entries: list, nextBefore: null, bytes: 0, status: "ok", invalidLines: 0, ...more };
}

function testEnv(view: ConversationWindow, read: Conversation["read"]) {
  const state = { view, offset: 5 as number | "end" };
  const env: ReadEnv = {
    conversation: { current: { read, watch: vi.fn(), close: vi.fn(), threadId: "t" } },
    reading: { current: false },
    latest: { current: { view, follow: false, offset: 5 } },
    toast: { error: vi.fn() } as unknown as ToastStore,
    setView: vi.fn((next) => {
      state.view = typeof next === "function" ? next(state.view) : next;
    }),
    setOffset: vi.fn((next) => {
      state.offset = typeof next === "function" ? next(state.offset) : next;
    }),
    rowsOf: (list) => list.length * 2,
  };

  return { env, state };
}

const WINDOW: ConversationWindow = { entries: entries(21, 20), older: true, newer: true, fresh: false, status: "ok" };

describe("conversation reads", () => {
  it("reads an older page and keeps the same text in view", async () => {
    const read = vi.fn(async () => page(entries(1, 20)));
    const { env, state } = testEnv(WINDOW, read);

    await loadOlder(env);

    expect(read).toHaveBeenCalledWith({ before: "m21", limit: 20 });
    expect(state.view.entries).toHaveLength(40);
    expect(state.offset).toBe(45);
  });

  it("reads a newer page", async () => {
    const read = vi.fn(async () => page(entries(41, 20), { nextAfter: null }));
    const { env, state } = testEnv(WINDOW, read);

    await loadNewer(env);

    expect(read).toHaveBeenCalledWith({ after: "m40", limit: 20 });
    expect(state.view).toMatchObject({ newer: false });
    expect(state.offset).toBe(5);
  });

  it("runs one read at a time", async () => {
    const { env } = testEnv(WINDOW, vi.fn());
    const task = vi.fn(async () => {});

    env.reading.current = true;
    await readExclusive(env, task);

    expect(task).not.toHaveBeenCalled();
  });

  it("reads the end again when the cursor left the branch, and shows other errors", async () => {
    const read = vi.fn(async () => page(entries(1, 2)));
    const { env, state } = testEnv(WINDOW, read);

    await readExclusive(env, async () => {
      throw new Error("The entry is no longer available");
    });

    expect(state.view.entries).toHaveLength(2);
    expect(state.offset).toBe("end");

    await readExclusive(env, async () => {
      throw new Error("boom");
    });

    expect(env.toast.error).toHaveBeenCalledWith(new Error("boom"));
    expect(env.reading.current).toBe(false);
  });
});
