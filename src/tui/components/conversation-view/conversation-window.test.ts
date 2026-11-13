import { describe, expect, it } from "vitest";
import type { ConversationEntry, ConversationPage } from "../../../services/conversation/conversation.js";
import {
  type ConversationWindow,
  errorWindow,
  newerWindow,
  newestWindow,
  olderWindow,
  shownParts,
  statusText,
  viewport,
  watchedWindow,
} from "./conversation-window.js";

function entries(from: number, count: number): ConversationEntry[] {
  return Array.from({ length: count }, (_, i) => ({ id: `m${from + i}`, type: "message", text: `${from + i}` }));
}

function page(list: ConversationEntry[], more: Partial<ConversationPage> = {}): ConversationPage {
  return { entries: list, nextBefore: null, bytes: 0, status: "ok", invalidLines: 0, ...more };
}

const OK: ConversationWindow = { entries: entries(1, 3), older: false, newer: false, fresh: false, status: "ok" };

function ids(window: ConversationWindow): string[] {
  return window.entries.map((entry) => entry.id);
}

describe("conversation windows", () => {
  it("starts from the newest page, or from an error", () => {
    expect(newestWindow(page(entries(1, 2), { nextBefore: "c" }))).toMatchObject({ older: true, status: "ok" });
    expect(errorWindow(new Error("gone"))).toMatchObject({ status: "error", error: "gone", entries: [] });
  });

  it("keeps at most three pages when it reads an older page", () => {
    const full = { ...OK, entries: entries(21, 60) };
    const next = olderWindow(full, page(entries(1, 20), { nextBefore: "c" }));

    expect(next.entries).toHaveLength(60);
    expect(ids(next)[0]).toBe("m1");
    expect(next).toMatchObject({ older: true, newer: true });
  });

  it("drops the oldest entries when it reads a newer page", () => {
    const full = { ...OK, entries: entries(1, 60), newer: true, fresh: true };
    const { window, dropped } = newerWindow(full, page(entries(61, 20), { nextAfter: null }));

    expect(dropped.map((entry) => entry.id)).toEqual(ids({ ...OK, entries: entries(1, 20) }));
    expect(window).toMatchObject({ older: true, newer: false, fresh: false });
    expect(ids(window).at(-1)).toBe("m80");
  });

  it("adds the watched entries while it follows, and keeps them below while it does not", () => {
    const watched = page(entries(1, 5));

    expect(ids(watchedWindow(OK, watched, true))).toEqual(["m1", "m2", "m3", "m4", "m5"]);
    expect(watchedWindow(OK, watched, false)).toMatchObject({ entries: OK.entries, newer: true, fresh: true });
    expect(watchedWindow(OK, page(entries(1, 3)), true)).toBe(OK);
    expect(watchedWindow({ ...OK, status: "loading" }, watched, true).status).toBe("loading");
    expect(ids(watchedWindow(OK, page(entries(7, 2)), true))).toEqual(["m7", "m8"]);
  });
});

describe("the viewport", () => {
  const blocks = [
    { entry: entries(1, 1)[0]!, lines: [1, 2, 3].map((n) => ({ text: `a${n}`, tone: "body" as const })) },
    { entry: entries(2, 1)[0]!, lines: [1, 2].map((n) => ({ text: `b${n}`, tone: "body" as const })) },
  ];

  it("shows the end, or the rows from an offset", () => {
    expect(viewport(blocks, 3, "end")).toEqual({ total: 5, rows: 2, max: 3, start: 3 });
    expect(viewport(blocks, 3, 9).start).toBe(3);
    expect(viewport(blocks, undefined, 0)).toEqual({ total: 5, rows: 5, max: 0, start: 0 });
  });

  it("cuts each entry to its rows in view", () => {
    expect(shownParts(blocks, viewport(blocks, 3, 2))).toEqual([
      { id: "m1", lines: [{ text: "a3", tone: "body" }] },
      { id: "m2", lines: [{ text: "b1", tone: "body" }] },
    ]);
  });

  it("says which rows show and what the history holds around them", () => {
    const port = viewport(blocks, 3, 0);

    expect(statusText({ ...OK, older: true, newer: true }, port, true, true)).toBe(
      "1–2 of 5 rows · ↑ older · ↓ newer · f follow",
    );
    expect(statusText(OK, viewport(blocks, 3, "end"), true, true)).toBe("4–5 of 5 rows · following");
    expect(statusText({ ...OK, fresh: true }, viewport([], 3, "end"), false, false)).toBe("No entries · ↓ new entries");
  });
});
