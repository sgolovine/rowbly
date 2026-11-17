import { describe, expect, it } from "vitest";
import { lastCheckOf } from "./host-last-check.js";

describe("lastCheckOf", () => {
  it("gives the time of the context, the ready state and the ids of the fail items in order", () => {
    const now = () => new Date("2026-11-16T10:00:00.000Z");
    const check = {
      ready: false,
      items: [
        { id: "ssh", state: "ok" },
        { id: "gh", state: "fail" },
        { id: "git-identity", state: "warning" },
        { id: "clone", state: "fail" },
      ],
    };

    expect(lastCheckOf(check, { now })).toEqual({
      at: "2026-11-16T10:00:00.000Z",
      ready: false,
      failed: ["gh", "clone"],
    });
  });
});
