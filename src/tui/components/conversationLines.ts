import type { ConversationEntry } from "../../services/conversation/conversation.js";
import { formatDateTime } from "../theme.js";
import { type MarkdownRenderer, plainMarkdownRows } from "./markdown.js";

/** How a line of a conversation reads: its ink and its weight. */
export type ConversationTone = "label" | "body" | "quiet" | "error";

/** One terminal row of a conversation entry. */
export interface ConversationLine {
  text: string;
  tone: ConversationTone;
  /** Text after the label, in `ink-faint`, for example the time of the entry. */
  meta?: string;
  /** Text after the label, in `danger`, for example `error` on a failed tool result. */
  alert?: string;
}

/** The columns of the indent before the body of an entry. */
const INDENT = 2;
/** A tool result shows this many rows, then a `… n more lines` row. */
const TOOL_RESULT_ROWS = 12;
/** A tool call shows this many rows of its arguments. */
const TOOL_CALL_ROWS = 3;
/** No entry takes more rows than this, so one long message cannot fill the memory. */
const ENTRY_ROWS = 400;

/** Removes terminal escape sequences and control characters: a conversation is text, never terminal commands. */
export function safeText(text: string): string {
  return (
    text
      // biome-ignore lint/suspicious/noControlCharactersInRegex: these are the sequences to remove.
      .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(\u0007|\u001b\\)?|\u001b[@-_]/g, "")
      .replaceAll("\t", "  ")
      .replaceAll("\r\n", "\n")
      // biome-ignore lint/suspicious/noControlCharactersInRegex: these are the characters to remove.
      .replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, "")
  );
}

/** Rows of plain text of at most `width` characters, with the line breaks of the text. */
function plainRows(text: string, width: number): string[] {
  const w = Math.max(1, width);
  return text.split("\n").flatMap((line) => {
    const chars = Array.from(line);
    const rows: string[] = [];
    for (let i = 0; i < chars.length; i += w) rows.push(chars.slice(i, i + w).join(""));
    return rows.length ? rows : [""];
  });
}

/** Rows of prose of at most `width` characters, broken between words where a word fits on a row. */
function wordRows(text: string, width: number): string[] {
  const w = Math.max(1, width);
  return text.split("\n").flatMap((line) => {
    const rows: string[] = [];
    let row = "";
    for (const word of line.split(" ")) {
      const next = row ? `${row} ${word}` : word;
      if (Array.from(next).length <= w) {
        row = next;
        continue;
      }
      if (row) rows.push(row);
      // A word longer than the row breaks at the width.
      const chars = Array.from(word);
      while (chars.length > w) rows.push(chars.splice(0, w).join(""));
      row = chars.join("");
    }
    rows.push(row);
    return rows;
  });
}

/** `rows` cut at `max`, with a last row that counts the rows that it leaves out. */
function capped(rows: string[], max: number, tone: ConversationTone): ConversationLine[] {
  const shown = rows.length > max ? rows.slice(0, max - 1) : rows;
  const lines = shown.map((text) => ({ text, tone }));
  if (rows.length > max) lines.push({ text: `… ${rows.length - shown.length} more lines`, tone: "quiet" });
  return lines;
}

const indent = (lines: ConversationLine[]): ConversationLine[] =>
  lines.map((line) => ({ ...line, text: `${" ".repeat(INDENT)}${line.text}` }));

/** The rows of the text of an agent or a user: Markdown, with tool calls, thinking and errors on rows of their own. */
function messageRows(text: string, width: number, render: MarkdownRenderer): ConversationLine[] {
  const lines: ConversationLine[] = [];
  let prose: string[] = [];
  const flush = () => {
    if (prose.join("").trim())
      lines.push(...render(prose.join("\n"), width).map((row) => ({ text: row, tone: "body" as const })));
    prose = [];
  };
  for (const line of text.split("\n")) {
    const tool = /^\[tool ([^\]\s]+)\] ?(.*)$/.exec(line);
    if (tool) {
      flush();
      lines.push({ text: "Tool call", tone: "label", meta: tool[1] });
      lines.push(...capped(plainRows(tool[2] ?? "", width), TOOL_CALL_ROWS, "quiet"));
    } else if (line.startsWith("[thinking]") || line === "[redacted thinking]") {
      flush();
      lines.push(
        ...wordRows(line.replace(/^\[thinking\] ?/, "Thinking: "), width).map((row) => ({
          text: row,
          tone: "quiet" as const,
        })),
      );
    } else if (line.startsWith("[error] ")) {
      flush();
      lines.push(...wordRows(line.slice(8), width).map((row) => ({ text: row, tone: "error" as const })));
    } else prose.push(line);
  }
  flush();
  return lines;
}

/** The label and the body rows of an entry, before the indent and the limit. */
function parts(entry: ConversationEntry, width: number, render: MarkdownRenderer) {
  const text = safeText(entry.text);
  if (entry.oversized)
    return { label: "Large entry", body: plainRows(text, width).map((row) => ({ text: row, tone: "quiet" as const })) };
  if (entry.type === "message") {
    const [first = "", ...rest] = text.split("\n");
    if (entry.role === "toolResult") {
      const head = /^\[tool result ?([^\]]*?)( error)?\]$/.exec(first);
      return {
        label: "Tool result",
        meta: head?.[1] || undefined,
        alert: head?.[2] ? "error" : undefined,
        body: capped(plainRows((head ? rest : [first, ...rest]).join("\n"), width), TOOL_RESULT_ROWS, "body"),
      };
    }
    if (entry.role === "bashExecution") {
      return {
        label: "Shell",
        meta: first.replace(/^\[bash\] ?/, ""),
        body: capped(plainRows(rest.join("\n"), width), TOOL_RESULT_ROWS, "body"),
      };
    }
    const label = entry.role === "user" ? "User" : entry.role === "assistant" ? "Agent" : (entry.role ?? "Message");
    return { label, body: messageRows(text, width, render) };
  }
  if (entry.type === "compaction" || entry.type === "branch_summary") {
    const label = entry.type === "compaction" ? "Compaction" : "Branch summary";
    const summary = text.replace(/^\[(compaction|branch_summary)\] ?/, "");
    return { label, body: wordRows(summary, width).map((row) => ({ text: row, tone: "quiet" as const })) };
  }
  if (entry.type === "custom_message") return { label: "Factory message", body: messageRows(text, width, render) };
  return { label: entry.type.replaceAll("_", " "), body: [] as ConversationLine[] };
}

/**
 * The terminal rows of one conversation entry at `width` columns: a label row with the time, then the body,
 * two columns to the right, then one blank row. The text is safe for the terminal, and the rows are bounded.
 */
export function conversationLines(
  entry: ConversationEntry,
  width: number,
  render: MarkdownRenderer = plainMarkdownRows,
): ConversationLine[] {
  const { label, meta, alert, body } = parts(entry, Math.max(1, width - INDENT), render);
  const time =
    entry.timestamp && Number.isFinite(Date.parse(entry.timestamp)) ? formatDateTime(entry.timestamp) : undefined;
  return [
    { text: label, tone: "label", meta: [meta, time].filter(Boolean).join(" · ") || undefined, alert },
    ...indent(
      body.length > ENTRY_ROWS
        ? capped(
            body.map((line) => line.text),
            ENTRY_ROWS,
            "body",
          )
        : body,
    ),
    { text: "", tone: "body" },
  ];
}
