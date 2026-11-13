import { Text } from "ink";
import { cleanup } from "ink-testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Conversation, ConversationPage } from "../../../services/conversation/conversation.js";
import { renderTui } from "../../testing/index.js";
import { useConversationWindow } from "./use-conversation-window.js";

afterEach(cleanup);

const PAGE: ConversationPage = {
  entries: [{ id: "m1", type: "message", role: "user", text: "hello" }],
  nextBefore: "m0",
  bytes: 0,
  status: "ok",
  invalidLines: 0,
};

// The conversation opens again when `ctx` changes, so it must keep one reference.
const CTX = {};

function Probe({ open }: { open: () => Promise<Conversation> }) {
  const state = useConversationWindow({ ctx: CTX, threadId: "t", live: false, width: 40, open });

  return <Text>{`${state.view.status}|${state.blocks.map((block) => block.lines[1]?.text).join(",")}`}</Text>;
}

describe("useConversationWindow", () => {
  it("opens the thread and gives the rows of each entry", async () => {
    const c: Conversation = { threadId: "t", read: vi.fn(async () => PAGE), watch: vi.fn(), close: vi.fn() };
    const tui = await renderTui(<Probe open={async () => c} />);

    await vi.waitFor(async () => {
      await tui.press();
      expect(tui.frame()).toContain("ok|  hello");
    });

    tui.unmount();

    expect(c.close).toHaveBeenCalled();
  });
});
