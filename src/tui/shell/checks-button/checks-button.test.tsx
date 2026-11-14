import { cleanup } from "ink-testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderTui } from "../../testing/index.js";
import { ChecksButton, checksButtonWidth } from "./checks-button.js";

afterEach(cleanup);

const CHECKS = { running: 2, queued: 1, maxConcurrent: 4, jobs: [] };

describe("ChecksButton", () => {
  it("shows the running and the queued counts with its key", async () => {
    const tui = await renderTui(<ChecksButton checks={CHECKS} showKey onClick={() => {}} clickable />);
    expect(tui.frame()).toMatch(/Checks 2\/1 {2}c/);
  });

  it("has the width that the header fit uses", async () => {
    const tui = await renderTui(<ChecksButton checks={CHECKS} showKey={false} onClick={() => {}} clickable />);
    // The padding takes one column on each side of the text.
    expect(tui.frame().trim().length + 2).toBe(checksButtonWidth(CHECKS, false));
    expect(checksButtonWidth(CHECKS, true)).toBe(checksButtonWidth(CHECKS, false) + 4);
  });

  it("calls onClick on a click", async () => {
    const onClick = vi.fn();
    const tui = await renderTui(<ChecksButton checks={CHECKS} showKey onClick={onClick} clickable />);
    await tui.click("Checks");
    expect(onClick).toHaveBeenCalledOnce();
  });
});
