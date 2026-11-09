import { cleanup } from "ink-testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useTempDir } from "../../../../services/testProject/testProject.js";
import { keys, renderTui, settle } from "../../../testing/index.js";
import { OnboardingProjectStep } from "./OnboardingProjectStep.js";

afterEach(cleanup);

describe("OnboardingProjectStep", () => {
  const dir = useTempDir();
  const props = { name: "rowbly", projectKey: "ROW", onBack: () => {}, onHints: () => {} };

  it("starts with the defaults and goes on with enter", async () => {
    const onNext = vi.fn();
    const tui = await renderTui(<OnboardingProjectStep {...props} ctx={{ cwd: dir.path }} onNext={onNext} />);
    expect(tui.frame()).toContain("rowbly");
    expect(tui.frame()).toContain("ROW");
    await tui.press(keys.enter);
    await settle(50);
    expect(onNext).toHaveBeenCalledWith("rowbly", "ROW");
  });

  it("updates the default key when the name changes", async () => {
    const onNext = vi.fn();
    const tui = await renderTui(<OnboardingProjectStep {...props} ctx={{ cwd: dir.path }} onNext={onNext} />);
    await tui.press(keys.backspace.repeat(6));
    await tui.type("Web");
    await tui.press(keys.enter);
    await settle(50);
    expect(onNext).toHaveBeenCalledWith("Web", "WEB");
  });

  it("shows a bad key under its field", async () => {
    const onNext = vi.fn();
    const tui = await renderTui(
      <OnboardingProjectStep {...props} projectKey="1X" ctx={{ cwd: dir.path }} onNext={onNext} />,
    );
    await tui.press(keys.enter);
    await settle(50);
    await tui.press();
    expect(tui.frame()).toContain("must be uppercase letters");
    expect(onNext).not.toHaveBeenCalled();
  });
});
