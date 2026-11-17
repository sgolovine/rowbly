import { describe, expect, it } from "vitest";
import { displayEntry, oversizedEntry } from "./session-display.js";
import type { EntryIndex } from "./session-types.js";

const meta = (type = "message"): EntryIndex => ({
  id: "a",
  parentId: null,
  type,
  timestamp: "t",
  offset: 0,
  length: 10,
});

describe("session display", () => {
  it("renders message roles and content blocks", () => {
    const content = [
      { type: "text", text: "hello" },
      { type: "thinking", thinking: "hmm" },
      { type: "thinking", redacted: true },
      { type: "image", mimeType: "image/png" },
      { type: "toolCall", name: "read", arguments: { path: "a" } },
      { type: "other" },
      7,
    ];
    expect(displayEntry({ type: "message", message: { role: "assistant", content } }, meta())).toEqual({
      id: "a",
      type: "message",
      timestamp: "t",
      role: "assistant",
      text: 'hello\n[thinking] hmm\n[redacted thinking]\n[image: image/png]\n[tool read] {"path":"a"}\n[other]\n[unknown content]',
    });
    expect(
      displayEntry(
        { type: "message", message: { role: "bashExecution", command: "ls", output: "x", errorMessage: "e" } },
        meta(),
      ).text,
    ).toBe("[bash] ls\nx\n[error] e");
    expect(
      displayEntry(
        { type: "message", message: { role: "toolResult", toolName: "read", isError: true, content: "no" } },
        meta(),
      ).text,
    ).toBe("[tool result read error]\nno");
    expect(displayEntry({ type: "message" }, meta()).role).toBe("unknown");
  });

  it("renders other records and bounds the text", () => {
    expect(displayEntry({ type: "compaction", summary: "s" }, meta("compaction")).text).toBe("[compaction] s");
    expect(displayEntry({ type: "custom_message", display: false }, meta("custom_message")).text).toBe(
      "[hidden custom message]",
    );
    expect(displayEntry({ type: "label" }, meta("label"))).toEqual({
      id: "a",
      type: "label",
      timestamp: "t",
      text: "[label]",
    });
    expect(displayEntry({ type: "message", message: { content: "x".repeat(40_000) } }, meta()).text).toHaveLength(
      32 * 1024,
    );
    expect(oversizedEntry(meta())).toMatchObject({ text: "[oversized message: 10 bytes]", oversized: true });
  });
});
