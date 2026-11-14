import { cleanup } from "ink-testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderTui } from "../../../testing/index.js";
import { CheckList } from "./check-list.js";

afterEach(cleanup);

const checks = [
  {
    key: "test",
    label: "Tests",
    command: "pnpm test",
    narrowCommand: "pnpm vitest {files}",
    memoryMb: 1,
    timeoutMinutes: 1,
    block: [],
  },
  { key: "lint", label: "lint", command: "pnpm lint", memoryMb: 1, timeoutMinutes: 1, block: [] },
];

describe("CheckList", () => {
  it("shows each check with its forms and command, and a click picks the row", async () => {
    const onPick = vi.fn();
    const tui = await renderTui(<CheckList checks={checks} cursor={1} active onPick={onPick} />);

    expect(tui.frame()).toMatch(/Tests \(test\)\s+full \+ narrow\s+pnpm test/);
    expect(tui.frame()).toMatch(/▌ lint\s+full\s+pnpm lint/);

    await tui.click("pnpm test");

    expect(onPick).toHaveBeenCalledWith(0);
  });
});
