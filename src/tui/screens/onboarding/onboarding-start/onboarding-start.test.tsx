import { cleanup } from "ink-testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { keys, renderTui } from "../../../testing/index.js";
import { OnboardingStart } from "./onboarding-start.js";

afterEach(cleanup);

describe("OnboardingStart", () => {
  it("offers the defaults or customize", async () => {
    const onChoose = vi.fn();
    const tui = await renderTui(<OnboardingStart onChoose={onChoose} onHints={() => {}} />);
    await tui.press(keys.enter);
    expect(onChoose).toHaveBeenLastCalledWith("defaults");
    await tui.press(keys.down, keys.enter);
    expect(onChoose).toHaveBeenLastCalledWith("customize");
  });
});
