import { cleanup } from "ink-testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { keys, renderTui } from "../../../testing/index.js";
import { ThinkingPicker } from "./thinking-picker.js";

afterEach(cleanup);

describe("ThinkingPicker", () => {
  it("starts on the level in use and gives the chosen level", async () => {
    const onSelect = vi.fn();
    const tui = await renderTui(
      <ThinkingPicker modelId="acme/deep-1" levels={["low", "high"]} current="low" active onSelect={onSelect} />,
    );

    expect(tui.frame()).toContain("The thinking levels of acme/deep-1");
    expect(tui.frame()).toContain("Model default");

    await tui.press(keys.down);
    await tui.press(keys.enter);

    expect(onSelect).toHaveBeenCalledWith("high");
  });
});
