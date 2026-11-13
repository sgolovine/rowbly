/** The location and the small fields of one entry line in a session file. */
export interface EntryIndex {
  id: string;
  parentId: string | null;
  type: string;
  timestamp?: string;
  offset: number;
  length: number;
}

export interface ConversationEntry {
  id: string;
  type: string;
  timestamp?: string;
  role?: string;
  text: string;
  oversized?: boolean;
}

export interface ConversationPage {
  entries: ConversationEntry[];
  nextBefore: string | null;
  /** On a page read with `after`: the cursor for the next newer page, or `null` at the newest entry. */
  nextAfter?: string | null;
  bytes: number;
  status: "ok" | "missing" | "unsupported";
  invalidLines: number;
}

/** One parsed JSON record of a session file. */
export type JsonObject = Record<string, unknown>;

export const MAX_ENTRY_BYTES = 256 * 1024;
