import { describe, expect, it } from "vitest";
import type { ConversationEntry } from "../../../services/conversation/conversation.js";
import { cachedLines, type LineCache, pruneLines } from "./line-cache.js";

const A: ConversationEntry = { id: "a", type: "message", role: "user", text: "hello" };
const B: ConversationEntry = { id: "b", type: "message", role: "user", text: "there" };

describe("the line cache", () => {
  it("renders an entry one time for each width", () => {
    const cache = { current: new Map() as LineCache };
    const first = cachedLines(cache, A, 40, undefined);

    expect(cachedLines(cache, A, 40, undefined)).toBe(first);
    expect(cachedLines(cache, A, 20, undefined)).not.toBe(first);
    expect([...cache.current.keys()]).toEqual(["a:40:0", "a:20:0"]);
  });

  it("removes the rows of the entries that left the window", () => {
    const cache = { current: new Map() as LineCache };

    cachedLines(cache, A, 40, undefined);
    cachedLines(cache, B, 40, undefined);
    cachedLines(cache, B, 20, undefined);
    pruneLines(cache, [B], 40, undefined);

    expect([...cache.current.keys()]).toEqual(["b:40:0"]);
  });
});
