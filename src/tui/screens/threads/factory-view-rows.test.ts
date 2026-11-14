import { describe, expect, it } from "vitest";
import type { ThreadRecord } from "../../../services/thread/thread.js";
import { factoryViewCursor, factoryViewRows, sectionRowId } from "./factory-view-rows.js";

function thread(id: string, status: ThreadRecord["status"]): ThreadRecord {
  return { id, status } as ThreadRecord;
}

const GROUPS = {
  active: [thread("t3", "running")],
  inactive: [thread("t2", "failed"), thread("t1", "completed")],
};

describe("factoryViewRows", () => {
  it("gives each section heading with its count, then its Threads", () => {
    const rows = factoryViewRows(GROUPS, new Set());

    expect(rows.map((row) => row.id)).toEqual(["section:active", "t3", "section:inactive", "t2", "t1"]);
    expect(rows[0]).toMatchObject({ kind: "section", label: "Active Threads", count: 1, collapsed: false });
    expect(rows[2]).toMatchObject({ kind: "section", label: "Inactive Threads", count: 2 });
  });

  it("leaves out the Threads of a collapsed section", () => {
    const rows = factoryViewRows(GROUPS, new Set(["inactive"]));

    expect(rows.map((row) => row.id)).toEqual(["section:active", "t3", "section:inactive"]);
    expect(rows[2]).toMatchObject({ collapsed: true, count: 2 });
  });

  it("shows both headings without Threads", () => {
    expect(factoryViewRows({ active: [], inactive: [] }, new Set()).map((row) => row.id)).toEqual([
      sectionRowId("active"),
      sectionRowId("inactive"),
    ]);
  });
});

describe("factoryViewCursor", () => {
  const rows = factoryViewRows(GROUPS, new Set());

  it("finds the selected row, and starts on the first Thread without a selection", () => {
    expect(factoryViewCursor(rows, "t2")).toBe(3);
    expect(factoryViewCursor(rows, null)).toBe(1);
    expect(factoryViewCursor(rows, "gone")).toBe(1);
  });

  it("starts on the first heading when there is no Thread", () => {
    expect(factoryViewCursor(factoryViewRows({ active: [], inactive: [] }, new Set()), null)).toBe(0);
  });
});
