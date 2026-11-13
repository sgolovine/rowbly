import { describe, expect, it } from "vitest";
import { conversationLines, safeText } from "./conversation-lines.js";

const at = "2026-11-12T10:00:00.000Z";

describe("conversationLines", () => {
  it("shows a user message with its label, time and indented body, then a blank row", () => {
    const lines = conversationLines(
      { id: "a", type: "message", role: "user", timestamp: at, text: "Develop the Story." },
      40,
    );
    expect(lines[0]).toMatchObject({ text: "User", tone: "label" });
    expect(lines[0]?.meta).toMatch(/^12 Nov 2026, \d\d:\d\d$/);
    expect(lines[1]).toEqual({ text: "  Develop the Story.", tone: "body" });
    expect(lines.at(-1)).toEqual({ text: "", tone: "body" });
  });

  it("puts the tool calls of an agent on rows of their own", () => {
    const text = 'I read the file.\n[tool bash] {"command":"ls"}\n[thinking] Plan the form\n[error] Stopped';
    const lines = conversationLines({ id: "b", type: "message", role: "assistant", text }, 40);
    expect(lines.map((l) => [l.text, l.tone, l.meta])).toEqual([
      ["Agent", "label", undefined],
      ["  I read the file.", "body", undefined],
      ["  Tool call", "label", "bash"],
      ['  {"command":"ls"}', "quiet", undefined],
      ["  Thinking: Plan the form", "quiet", undefined],
      ["  Stopped", "error", undefined],
      ["", "body", undefined],
    ]);
  });

  it("cuts a long tool result and marks a failed one", () => {
    const output = Array.from({ length: 30 }, (_, i) => `line ${i}`).join("\n");
    const lines = conversationLines(
      { id: "c", type: "message", role: "toolResult", text: `[tool result bash error]\n${output}` },
      40,
    );
    expect(lines[0]).toMatchObject({ text: "Tool result", meta: "bash", alert: "error" });
    expect(lines).toHaveLength(1 + 12 + 1);
    expect(lines[12]?.text).toBe("  … 19 more lines");
  });

  it("marks compaction and large entries, and wraps at the width", () => {
    const compaction = conversationLines({ id: "d", type: "compaction", text: "[compaction] Summary" }, 40);
    expect(compaction.slice(0, 2).map((l) => l.text)).toEqual(["Compaction", "  Summary"]);
    const large = conversationLines(
      { id: "e", type: "message", text: "[oversized message: 300000 bytes]", oversized: true },
      40,
    );
    expect(large[0]?.text).toBe("Large entry");
    const wrapped = conversationLines({ id: "f", type: "message", role: "user", text: "x".repeat(30) }, 12);
    expect(wrapped.slice(1, -1).map((l) => l.text)).toEqual(["  xxxxxxxxxx", "  xxxxxxxxxx", "  xxxxxxxxxx"]);
  });

  it("breaks a summary between words, and a long word at the width", () => {
    const lines = conversationLines(
      { id: "g", type: "compaction", text: "[compaction] The worker planned the form abcdefghijklmnop" },
      16,
    );
    expect(lines.slice(1, -1).map((l) => l.text)).toEqual([
      "  The worker",
      "  planned the",
      "  form",
      "  abcdefghijklmn",
      "  op",
    ]);
  });

  it("removes terminal escape sequences and control characters", () => {
    expect(safeText("\u001b[31mred\u001b[0m\u0007 and \u001b]0;title\u0007tab\there")).toBe("red and tab  here");
  });
});
