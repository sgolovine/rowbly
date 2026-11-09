import { cleanup } from "ink-testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { renderTui } from "../../testing/index.js";
import { StageBadge } from "./StageBadge.js";

afterEach(cleanup);

describe("StageBadge", () => {
  it("shows a dot before the stage name for each category", async () => {
    for (const category of ["backlog", "board", "done"] as const) {
      const tui = await renderTui(<StageBadge stage={{ name: "In review", category }} />);
      expect(tui.frame()).toBe("● In review");
      tui.unmount();
    }
  });
});
