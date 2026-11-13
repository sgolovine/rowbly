import { describe, expect, it } from "vitest";
import type { ThreadRecord } from "../../../../services/thread/thread.js";
import { threadsHints, threadsLayout } from "./threads-tab-view.js";

const running: ThreadRecord = {
  version: 1,
  id: "t",
  revision: 2,
  role: "worker",
  storyId: "ROW-01",
  stage: "DEVELOP",
  status: "running",
  createdAt: "2026-11-12T10:00:00.000Z",
  session: { id: "t", file: null },
  cwd: "/p",
  runs: [{ id: "r", ownerToken: "o", createdAt: "2026-11-12T10:00:00.000Z", status: "running" }],
  resumable: false,
};

describe("threadsHints", () => {
  it("gives no keys while another region has the keys", () => {
    expect(threadsHints({ keysOwn: false, viewing: false, current: running, count: 1 })).toEqual([]);
  });

  it("gives the list keys, then the actions", () => {
    const hints = threadsHints({ keysOwn: true, viewing: false, current: running, count: 1 });
    expect(hints.map((hint) => hint.key)).toEqual(["↑/↓", "enter/tab", "x"]);
  });

  it("gives the actions first in the thread region, and esc last", () => {
    const hints = threadsHints({ keysOwn: true, viewing: true, current: running, count: 1 });
    expect(hints[0]?.key).toBe("x");
    expect(hints.at(-1)).toEqual({ key: "esc", description: "back to Threads" });
  });
});

describe("threadsLayout", () => {
  it("puts the list and the thread side by side in a wide Modal", () => {
    const view = threadsLayout({ width: 120, height: 30 }, "list", running);
    expect(view).toMatchObject({ split: true, showList: true, showThread: true, compact: false });
    expect(view.threadWidth).toBe(120 - 42 - 1 - 4);
  });

  it("shows only the region with the focus in a narrow Modal, with the compact detail in a low Modal", () => {
    const view = threadsLayout({ width: 60, height: 12 }, "thread", running);
    expect(view).toMatchObject({ split: false, showList: false, showThread: true, compact: true });
    expect(view.conversationHeight).toBeGreaterThanOrEqual(2);
  });

  it("lets the content set the height without a layout height", () => {
    const view = threadsLayout({ width: 120, height: undefined }, "list", undefined);
    expect(view.innerHeight).toBeUndefined();
    expect(view.conversationHeight).toBeUndefined();
  });
});
