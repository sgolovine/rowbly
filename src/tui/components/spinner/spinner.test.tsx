import { cleanup } from "ink-testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { renderTui, settle } from "../../testing/index.js";
import { Loading, Spinner } from "./spinner.js";

afterEach(cleanup);

describe("Spinner", () => {
  it("starts on the first frame and moves on over time", async () => {
    const tui = await renderTui(<Spinner />);
    expect(tui.frame()).toBe("⠋");
    await settle(100);
    expect(tui.frame()).not.toBe("⠋");
    expect(tui.frame()).toMatch(/^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]$/);
  });
});

describe("Loading", () => {
  it("shows the spinner with the default label", async () => {
    const tui = await renderTui(<Loading />);
    expect(tui.frame()).toBe("⠋ Loading…");
  });

  it("shows a custom label", async () => {
    const tui = await renderTui(<Loading label="Saving story" />);
    expect(tui.frame()).toMatch(/^. Saving story$/);
  });
});
