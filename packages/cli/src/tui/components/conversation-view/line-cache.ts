import type { RefObject } from "react";
import type { ConversationEntry } from "../../../services/conversation/conversation.js";
import { withEntry } from "../../../services/store/store.js";
import { writeRef } from "../../hooks/index.js";
import { type ConversationLine, conversationLines } from "../conversation-lines.js";
import { type MarkdownRenderer, plainMarkdownRows } from "../markdown.js";

/**
 * The rows of each entry, kept by entry, width and renderer. It holds at most the entries of the window and of
 * one new page, because the entries that leave the window leave the cache.
 */
export type LineCache = ReadonlyMap<string, readonly ConversationLine[]>;

function lineKey(entry: ConversationEntry, width: number, render: MarkdownRenderer | undefined): string {
  return `${entry.id}:${width}:${render ? 1 : 0}`;
}

/** The rows of `entry`: from the cache, or rendered now and added to the cache. */
export function cachedLines(
  cache: RefObject<LineCache>,
  entry: ConversationEntry,
  width: number,
  render: MarkdownRenderer | undefined,
): readonly ConversationLine[] {
  const key = lineKey(entry, width, render);
  const known = cache.current.get(key);

  if (known) {
    return known;
  }

  const lines = conversationLines(entry, width, render ?? plainMarkdownRows);

  writeRef(cache, withEntry(cache.current, key, lines));

  return lines;
}

/** Removes the rows of the entries that are not in `entries`, or that have a different width or renderer. */
export function pruneLines(
  cache: RefObject<LineCache>,
  entries: readonly ConversationEntry[],
  width: number,
  render: MarkdownRenderer | undefined,
): void {
  const keep = new Set(entries.map((entry) => lineKey(entry, width, render)));

  writeRef(cache, new Map([...cache.current].filter(([key]) => keep.has(key))));
}
