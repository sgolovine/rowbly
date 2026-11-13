import { cleanup } from "ink-testing-library";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { keys, renderTui } from "../../../testing/index.js";
import { OnboardingChecklist, type OnboardingChecklistProps } from "./onboarding-checklist.js";

afterEach(cleanup);

const base: OnboardingChecklistProps = {
  heading: "Stages",
  description: "Choose",
  items: [
    { value: "a", label: "Alpha" },
    { value: "b", label: "Beta", description: "(required)", locked: true },
  ],
  selected: ["a", "b"],
  onSubmit: () => {},
  onBack: () => {},
  onHints: () => {},
};

function Growing(props: Partial<OnboardingChecklistProps>) {
  const [items, setItems] = useState(base.items);
  return (
    <OnboardingChecklist
      {...base}
      {...props}
      items={items}
      add={{
        label: "New Stage",
        onAdd: (text) => {
          if (text === "bad") return { error: "Bad name" };
          setItems((current) => [...current, { value: text, label: text }]);
          return { value: text };
        },
      }}
    />
  );
}

describe("OnboardingChecklist", () => {
  it("keeps a locked row checked and submits in row order", async () => {
    const onSubmit = vi.fn();
    const tui = await renderTui(<OnboardingChecklist {...base} onSubmit={onSubmit} />);
    expect(tui.frame()).toContain("(required)");
    await tui.press(keys.space, keys.down, keys.space, keys.enter);
    expect(onSubmit).toHaveBeenCalledWith(["b"]);
  });

  it("shows the empty error and goes back with esc", async () => {
    const onBack = vi.fn();
    const onSubmit = vi.fn();
    const tui = await renderTui(
      <OnboardingChecklist {...base} selected={[]} emptyError="Choose one" onBack={onBack} onSubmit={onSubmit} />,
    );
    await tui.press(keys.enter);
    expect(onSubmit).not.toHaveBeenCalled();
    expect(tui.frame()).toContain("Choose one");
    await tui.press(keys.escape);
    expect(onBack).toHaveBeenCalled();
  });

  it("adds a checked row with n, on the screen", async () => {
    const onSubmit = vi.fn();
    const tui = await renderTui(<Growing onSubmit={onSubmit} />);
    await tui.press("n");
    expect(tui.frame()).toContain("New Stage:");
    await tui.type("bad");
    await tui.press(keys.enter);
    expect(tui.frame()).toContain("Bad name");
    await tui.press(keys.backspace, keys.backspace, keys.backspace);
    await tui.type("QA");
    await tui.press(keys.enter);
    expect(tui.frame()).toContain("[x] QA");
    await tui.press(keys.enter);
    expect(onSubmit).toHaveBeenCalledWith(["a", "b", "QA"]);
  });

  it("cancels the new row with esc and does not go back", async () => {
    const onBack = vi.fn();
    const tui = await renderTui(<Growing onBack={onBack} />);
    await tui.press("n", keys.escape);
    expect(tui.frame()).not.toContain("New Stage:");
    expect(onBack).not.toHaveBeenCalled();
  });
});
