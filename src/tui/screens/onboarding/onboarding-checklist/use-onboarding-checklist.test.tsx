import { Text } from "ink";
import { cleanup } from "ink-testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { keys, renderTui } from "../../../testing/index.js";
import { useOnboardingChecklist } from "./use-onboarding-checklist.js";

afterEach(cleanup);

const items = [
  { value: "a", label: "A" },
  { value: "b", label: "B" },
];

function Probe(props: { onBack: () => void; onSubmit: (values: string[]) => void; onAdd?: () => { value: string } }) {
  const model = useOnboardingChecklist({
    items,
    selected: ["b"],
    emptyError: undefined,
    add: props.onAdd ? { label: "New row", onAdd: props.onAdd } : undefined,
    onSubmit: props.onSubmit,
    onBack: props.onBack,
    onHints: () => {},
  });

  return (
    <Text>
      adding={String(model.adding)} checked={model.checked.join(",")}
    </Text>
  );
}

describe("useOnboardingChecklist", () => {
  it("goes back with esc", async () => {
    const onBack = vi.fn();
    const tui = await renderTui(<Probe onBack={onBack} onSubmit={vi.fn()} />);

    await tui.press(keys.escape);

    expect(onBack).toHaveBeenCalledOnce();
  });

  it("opens the add input with n, and checks the new row with enter", async () => {
    const onAdd = vi.fn(() => ({ value: "c" }));
    const tui = await renderTui(<Probe onBack={vi.fn()} onSubmit={vi.fn()} onAdd={onAdd} />);

    await tui.press("n");

    expect(tui.frame()).toContain("adding=true");

    await tui.press(keys.enter);

    expect(onAdd).toHaveBeenCalledOnce();
    expect(tui.frame()).toContain("adding=false checked=b,c");
  });

  it("does not open the add input without a way to add", async () => {
    const tui = await renderTui(<Probe onBack={vi.fn()} onSubmit={vi.fn()} />);

    await tui.press("n");

    expect(tui.frame()).toContain("adding=false");
  });
});
