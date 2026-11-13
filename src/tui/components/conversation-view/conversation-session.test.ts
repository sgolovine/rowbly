import { describe, expect, it, vi } from "vitest";
import type { Conversation, ConversationPage } from "../../../services/conversation/conversation.js";
import { type OpenEnv, openWindow, watchWindow } from "./conversation-session.js";
import type { ConversationWindow } from "./conversation-window.js";

const PAGE: ConversationPage = {
  entries: [{ id: "m1", type: "message", text: "" }],
  nextBefore: null,
  bytes: 0,
  status: "ok",
  invalidLines: 0,
};

function fakeConversation(): Conversation {
  return { threadId: "t", read: vi.fn(async () => PAGE), watch: vi.fn(() => vi.fn()), close: vi.fn() };
}

function testEnv(open: OpenEnv["open"]): OpenEnv {
  return {
    open,
    threadId: "t",
    ctx: {},
    conversation: { current: undefined },
    cache: { current: new Map([["m1:40:0", []]]) },
    setView: vi.fn(),
    setOffset: vi.fn(),
    setOpened: vi.fn(),
  };
}

describe("openWindow", () => {
  it("reads the newest page, and closes the conversation in the cleanup", async () => {
    const c = fakeConversation();
    const env = testEnv(async () => c);
    const close = openWindow(env);

    await vi.waitFor(() => expect(env.setOpened).toHaveBeenCalled());
    expect(env.setView).toHaveBeenLastCalledWith(expect.objectContaining({ entries: PAGE.entries, status: "ok" }));

    close();

    expect(c.close).toHaveBeenCalled();
    expect(env.conversation.current).toBeUndefined();
    expect(env.cache.current.size).toBe(0);
  });

  it("closes a conversation that opens after the cleanup", async () => {
    const c = fakeConversation();
    const env = testEnv(async () => c);

    openWindow(env)();

    await vi.waitFor(() => expect(c.close).toHaveBeenCalled());
    expect(c.read).not.toHaveBeenCalled();
  });

  it("shows an error that the open gives", async () => {
    const env = testEnv(async () => {
      throw new Error("no thread");
    });

    openWindow(env);

    await vi.waitFor(() =>
      expect(env.setView).toHaveBeenLastCalledWith(expect.objectContaining({ status: "error", error: "no thread" })),
    );
  });
});

describe("watchWindow", () => {
  it("watches only a running thread with an open conversation", () => {
    const c = fakeConversation();
    const latest = { current: { view: {} as ConversationWindow, follow: true, offset: "end" as const } };

    expect(watchWindow({ current: c }, false, vi.fn(), latest)).toBeUndefined();
    expect(watchWindow({ current: undefined }, true, vi.fn(), latest)).toBeUndefined();
    expect(watchWindow({ current: c }, true, vi.fn(), latest)).toBeTypeOf("function");
  });
});
