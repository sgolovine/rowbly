import type { Key } from "ink";
import { describe, expect, it, vi } from "vitest";
import type { ToastStore } from "../../hooks/index.js";
import { conversationKeys, handleConversationKey, scrollBy, type ViewEnv } from "./conversation-keys.js";
import type { ConversationWindow } from "./conversation-window.js";

const VIEW: ConversationWindow = { entries: [], older: false, newer: false, fresh: false, status: "ok" };

function testEnv(more: Partial<ViewEnv> = {}): ViewEnv {
  return {
    conversation: { current: undefined },
    reading: { current: false },
    latest: { current: { view: VIEW, follow: false, offset: "end" } },
    toast: {} as ToastStore,
    setView: vi.fn(),
    setOffset: vi.fn(),
    rowsOf: () => 0,
    view: VIEW,
    port: { total: 50, rows: 10, max: 40, start: 20 },
    live: true,
    follow: true,
    setFollow: vi.fn(),
    ...more,
  };
}

function key(over: Partial<Key> = {}): Key {
  return over as Key;
}

describe("conversationKeys", () => {
  it("adds `f` while the thread runs", () => {
    expect(conversationKeys(true).map((hint) => hint.key)).toContain("f");
    expect(conversationKeys(false).map((hint) => hint.key)).not.toContain("f");
  });
});

describe("handleConversationKey", () => {
  it("scrolls within the rows, and a scroll up stops the follow", () => {
    const env = testEnv();

    scrollBy(env, -30);
    expect(env.setFollow).toHaveBeenCalledWith(false);
    expect(env.setOffset).toHaveBeenLastCalledWith(0);

    handleConversationKey(env, "", key({ pageDown: true }));
    expect(env.setOffset).toHaveBeenLastCalledWith(30);
  });

  it("goes to the oldest and the newest rows", () => {
    const env = testEnv();

    handleConversationKey(env, "", key({ home: true }));
    expect(env.setOffset).toHaveBeenLastCalledWith(0);

    handleConversationKey(env, "", key({ end: true }));
    expect(env.setFollow).toHaveBeenLastCalledWith(true);
    expect(env.setOffset).toHaveBeenLastCalledWith("end");
  });

  it("turns the follow off with `f`, and on again at the end", () => {
    const following = testEnv();

    handleConversationKey(following, "f", key());
    expect(following.setFollow).toHaveBeenCalledWith(false);

    const reading = testEnv({ follow: false });

    handleConversationKey(reading, "f", key());
    expect(reading.setOffset).toHaveBeenCalledWith("end");
  });

  it("leaves ctrl and meta keys to the screen", () => {
    const env = testEnv();

    handleConversationKey(env, "j", key({ ctrl: true }));
    handleConversationKey(env, "x", key());

    expect(env.setOffset).not.toHaveBeenCalled();
  });
});
