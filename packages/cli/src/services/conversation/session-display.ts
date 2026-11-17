import type { ConversationEntry, EntryIndex, JsonObject } from "./session-types.js";

// Output stays bounded even if a future renderer expands the source record.
const MAX_TEXT_LENGTH = 32 * 1024;

/** Gives one line of text for a content block of a Pi message. */
function blockText(block: unknown): string {
  if (!block || typeof block !== "object") {
    return "[unknown content]";
  }

  const { type, text, redacted, thinking, mimeType, name, arguments: args } = block as JsonObject;

  if (type === "text") {
    return typeof text === "string" ? text : "";
  }

  if (type === "thinking") {
    return redacted ? "[redacted thinking]" : `[thinking] ${thinking ?? ""}`;
  }

  if (type === "image") {
    return `[image: ${mimeType ?? "attachment"}]`;
  }

  if (type === "toolCall") {
    return `[tool ${name}] ${JSON.stringify(args)}`;
  }

  return `[${type ?? "unknown content"}]`;
}

/** Gives the text of a message content: a string, or a list of content blocks. */
function contentText(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (!Array.isArray(value)) {
    return "";
  }

  return value.map(blockText).join("\n");
}

function roleText(message: JsonObject | undefined, role: string): string {
  if (role === "bashExecution") {
    return `[bash] ${message?.command ?? ""}\n${message?.output ?? ""}`;
  }

  if (role === "toolResult") {
    return `[tool result ${message?.toolName ?? ""}${message?.isError ? " error" : ""}]\n${contentText(message?.content)}`;
  }

  return contentText(message?.content);
}

function messageText(message: JsonObject | undefined, role: string): string {
  const text = roleText(message, role);

  return message?.errorMessage ? `${text}\n[error] ${message.errorMessage}` : text;
}

function recordText(record: JsonObject, meta: EntryIndex): string {
  if (record.type === "compaction" || record.type === "branch_summary") {
    return `[${record.type}] ${record.summary ?? ""}`;
  }

  if (record.type === "custom_message") {
    return record.display === false ? "[hidden custom message]" : contentText(record.content);
  }

  return `[${meta.type}]`;
}

/** Gives the display form of one session record, with its text bounded. */
export function displayEntry(record: JsonObject, meta: EntryIndex): ConversationEntry {
  const base = { id: meta.id, type: meta.type, timestamp: meta.timestamp };

  if (record.type !== "message") {
    return { ...base, text: recordText(record, meta).slice(0, MAX_TEXT_LENGTH) };
  }

  const message = record.message as JsonObject | undefined;
  const role = typeof message?.role === "string" ? message.role : "unknown";

  return { ...base, text: messageText(message, role).slice(0, MAX_TEXT_LENGTH), role };
}

/** Gives the placeholder of an entry that is too large to read. */
export function oversizedEntry(meta: EntryIndex): ConversationEntry {
  return {
    id: meta.id,
    type: meta.type,
    timestamp: meta.timestamp,
    text: `[oversized ${meta.type}: ${meta.length} bytes]`,
    oversized: true,
  };
}
