import { cleanup } from "ink-testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { renderTui } from "../../testing/index.js";
import { conversationLines } from "../conversation-lines.js";
import { ConversationEntry } from "./conversation-entry.js";

afterEach(cleanup);

describe("ConversationEntry", () => {
  it("draws the label, the tool name, the alert and the body rows", async () => {
    const lines = conversationLines(
      { id: "a", type: "message", role: "toolResult", text: "[tool result bash error]\nnot found" },
      40,
    );
    const tui = await renderTui(<ConversationEntry lines={lines} />);
    expect(tui.frame().split("\n")).toEqual(["Tool result · bash · error", "  not found", ""]);
  });

  it("draws only the rows that it gets", async () => {
    const lines = conversationLines({ id: "b", type: "message", role: "user", text: "one\ntwo" }, 40);
    const tui = await renderTui(<ConversationEntry lines={lines.slice(1, 2)} />);
    expect(tui.frame()).toBe("  one");
  });
});
