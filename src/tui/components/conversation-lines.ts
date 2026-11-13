import type { ConversationEntry } from "../../services/conversation/conversation.js";
import { formatDateTime } from "../theme.js";
import { type MarkdownRenderer, plainMarkdownRows } from "./markdown.js";
import { plainRows, wordRows } from "./text-rows.js";

/** How a line of a conversation reads: its ink and its weight. */
export type ConversationTone = "label" | "body" | "quiet" | "error";

/** One terminal row of a conversation entry. */
export interface ConversationLine {
  readonly text: string;
  readonly tone: ConversationTone;
  /** Text after the label, in `ink-faint`, for example the time of the entry. */
  readonly meta?: string;
  /** Text after the label, in `danger`, for example `error` on a failed tool result. */
  readonly alert?: string;
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

/** `rows` cut at `max`, with a last row that counts the rows that it leaves out. */
function capped(rows: readonly string[], max: number, tone: ConversationTone): ConversationLine[] {
  const over = rows.length > max;
  const shown = over ? rows.slice(0, max - 1) : rows;
  const more: ConversationLine[] = over ? [{ text: `… ${rows.length - shown.length} more lines`, tone: "quiet" }] : [];

  return [...shown.map((text) => ({ text, tone })), ...more];
}

function toned(rows: readonly string[], tone: ConversationTone): ConversationLine[] {
  return rows.map((text) => ({ text, tone }));
}

function indent(lines: readonly ConversationLine[]): ConversationLine[] {
  return lines.map((line) => ({ ...line, text: `${" ".repeat(INDENT)}${line.text}` }));
}

/** How a line of a message shows: a tool call, thinking or an error on rows of their own, or a line of prose. */
type LineKind = "tool" | "thinking" | "error" | "prose";

const TOOL_LINE = /^\[tool ([^\]\s]+)\] ?(.*)$/;

function lineKind(line: string): LineKind {
  if (TOOL_LINE.test(line)) {
    return "tool";
  }

  if (line.startsWith("[thinking]") || line === "[redacted thinking]") {
    return "thinking";
  }

  return line.startsWith("[error] ") ? "error" : "prose";
}

/** The rows of one line that is not prose. */
function specialRows(line: string, kind: LineKind, width: number): ConversationLine[] {
  const tool = TOOL_LINE.exec(line);

  if (kind === "tool" && tool) {
    return [
      { text: "Tool call", tone: "label", meta: tool[1] },
      ...capped(plainRows(tool[2] ?? "", width), TOOL_CALL_ROWS, "quiet"),
    ];
  }

  if (kind === "thinking") {
    return toned(wordRows(line.replace(/^\[thinking\] ?/, "Thinking: "), width), "quiet");
  }

  return toned(wordRows(line.slice(8), width), "error");
}

/** The rows of a run of prose lines, as Markdown. A run with only blank text has no rows. */
function proseRows(lines: readonly string[], width: number, render: MarkdownRenderer): ConversationLine[] {
  return lines.join("").trim() ? toned(render(lines.join("\n"), width), "body") : [];
}

/** The rows of the text of an agent or a user: Markdown, with tool calls, thinking and errors on rows of their own. */
function messageRows(text: string, width: number, render: MarkdownRenderer): ConversationLine[] {
  const lines = text.split("\n");
  const kinds = lines.map(lineKind);
  // Each line that is not prose is a segment, and each run of prose lines is one segment.
  const starts = kinds.flatMap((kind, index) => (kind !== "prose" || kinds[index - 1] !== "prose" ? [index] : []));

  return starts.flatMap((start, index) => {
    const kind = kinds[start] ?? "prose";

    return kind === "prose"
      ? proseRows(lines.slice(start, starts[index + 1] ?? lines.length), width, render)
      : specialRows(lines[start] ?? "", kind, width);
  });
}

/** The label of a row and the rows of the body of an entry, before the indent and the limit. */
interface EntryParts {
  readonly label: string;
  readonly meta?: string;
  readonly alert?: string;
  readonly body: readonly ConversationLine[];
}

function messageLabel(role: string | undefined): string {
  if (role === "user") {
    return "User";
  }

  return role === "assistant" ? "Agent" : (role ?? "Message");
}

function toolResultParts(first: string, rest: readonly string[], width: number): EntryParts {
  const head = /^\[tool result ?([^\]]*?)( error)?\]$/.exec(first);
  const lines = head ? rest : [first, ...rest];

  return {
    label: "Tool result",
    meta: head?.[1] || undefined,
    alert: head?.[2] ? "error" : undefined,
    body: capped(plainRows(lines.join("\n"), width), TOOL_RESULT_ROWS, "body"),
  };
}

function messageParts(entry: ConversationEntry, text: string, width: number, render: MarkdownRenderer): EntryParts {
  const [first = "", ...rest] = text.split("\n");

  if (entry.role === "toolResult") {
    return toolResultParts(first, rest, width);
  }

  if (entry.role === "bashExecution") {
    return {
      label: "Shell",
      meta: first.replace(/^\[bash\] ?/, ""),
      body: capped(plainRows(rest.join("\n"), width), TOOL_RESULT_ROWS, "body"),
    };
  }

  return { label: messageLabel(entry.role), body: messageRows(text, width, render) };
}

function summaryParts(entry: ConversationEntry, text: string, width: number): EntryParts {
  const label = entry.type === "compaction" ? "Compaction" : "Branch summary";
  const summary = text.replace(/^\[(compaction|branch_summary)\] ?/, "");

  return { label, body: toned(wordRows(summary, width), "quiet") };
}

function parts(entry: ConversationEntry, width: number, render: MarkdownRenderer): EntryParts {
  const text = safeText(entry.text);

  if (entry.oversized) {
    return { label: "Large entry", body: toned(plainRows(text, width), "quiet") };
  }

  if (entry.type === "message") {
    return messageParts(entry, text, width, render);
  }

  if (entry.type === "compaction" || entry.type === "branch_summary") {
    return summaryParts(entry, text, width);
  }

  if (entry.type === "custom_message") {
    return { label: "Factory message", body: messageRows(text, width, render) };
  }

  return { label: entry.type.replaceAll("_", " "), body: [] };
}

/** The body cut at `ENTRY_ROWS`, so one long message cannot fill the memory. */
function boundedBody(body: readonly ConversationLine[]): readonly ConversationLine[] {
  return body.length > ENTRY_ROWS
    ? capped(
        body.map((line) => line.text),
        ENTRY_ROWS,
        "body",
      )
    : body;
}

function entryTime(entry: ConversationEntry): string | undefined {
  return entry.timestamp && Number.isFinite(Date.parse(entry.timestamp)) ? formatDateTime(entry.timestamp) : undefined;
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
  const time = entryTime(entry);

  return [
    { text: label, tone: "label", meta: [meta, time].filter(Boolean).join(" · ") || undefined, alert },
    ...indent(boundedBody(body)),
    { text: "", tone: "body" },
  ];
}
