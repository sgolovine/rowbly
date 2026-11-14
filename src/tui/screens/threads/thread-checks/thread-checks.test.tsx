import { cleanup } from "ink-testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { renderTui } from "../../../testing/index.js";
import { checkStatusText, ThreadChecks, threadCheckRows } from "./thread-checks.js";

afterEach(cleanup);

const checks = [
  { id: "1", key: "lint", scope: "full" as const, status: "passed", durationSeconds: 5 },
  { id: "2", key: "test", scope: "narrow" as const, status: "failed", durationSeconds: 100 },
  { id: "3", key: "test", scope: "full" as const, status: "timed_out", durationSeconds: 1800 },
  { id: "4", key: "test", scope: "full" as const, status: "running", durationSeconds: 0 },
];

describe("ThreadChecks", () => {
  it("shows the last three checks with their status and duration", async () => {
    const tui = await renderTui(<ThreadChecks checks={checks} />);

    expect(tui.frame()).not.toContain("lint");
    expect(tui.frame()).toContain("Check test narrow · failed · 1m40s");
    expect(tui.frame()).toContain("Check test full · timed out · 30m00s");
    expect(tui.frame()).toContain("Check test full · running");
    expect(threadCheckRows(checks)).toBe(3);
  });

  it("shows nothing without checks", async () => {
    const tui = await renderTui(<ThreadChecks checks={undefined} />);

    expect(tui.frame()).toBe("");
    expect(threadCheckRows(undefined)).toBe(0);
    expect(checkStatusText(checks[0] as never)).toBe("passed · 5s");
  });
});
