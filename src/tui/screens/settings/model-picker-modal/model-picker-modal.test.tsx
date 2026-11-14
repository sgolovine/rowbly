import { cleanup } from "ink-testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { keys, renderTui } from "../../../testing/index.js";
import { ModelPickerModal, NO_OVERRIDE_LABEL } from "./model-picker-modal.js";

afterEach(cleanup);

const models = [
  { provider: "acme", modelId: "deep-1", name: "Deep One", thinkingLevels: ["low", "high"] },
  { provider: "acme", modelId: "fast-1", name: "fast-1", thinkingLevels: [] },
];

describe("ModelPickerModal", () => {
  async function open() {
    const onSave = vi.fn(async () => {});
    const onClose = vi.fn();
    const tui = await renderTui(
      <ModelPickerModal title="AI › Supervisor model" models={models} onSave={onSave} onClose={onClose} />,
    );
    return { tui, onSave, onClose };
  }

  it("searches the models, then offers only the thinking levels of the model", async () => {
    const { tui, onSave } = await open();
    expect(tui.frame()).toContain("Pi default");
    expect(tui.frame()).toContain("acme/deep-1 · Deep One");
    await tui.type("deep");
    await tui.press(keys.enter);
    expect(tui.frame()).toContain("AI › Supervisor model › Thinking");
    expect(tui.frame()).toContain("Model default");
    expect(tui.frame()).toContain("high");
    expect(tui.frame()).not.toContain("xhigh");
    await tui.press(keys.down, keys.down, keys.enter);
    expect(onSave).toHaveBeenCalledWith({ provider: "acme", modelId: "deep-1", thinkingLevel: "high" });
  });

  it("saves a model without thinking levels at once, and the Pi default as null", async () => {
    const { tui, onSave } = await open();
    await tui.type("fast");
    await tui.press(keys.enter);
    expect(onSave).toHaveBeenLastCalledWith({ provider: "acme", modelId: "fast-1" });
    await tui.press(keys.ctrl("l"));
    await tui.type("Pi default");
    await tui.press(keys.enter);
    expect(onSave).toHaveBeenLastCalledWith(null);
  });

  it("labels the first option No override in an override picker, and saves it as null", async () => {
    const onSave = vi.fn(async () => {});
    const tui = await renderTui(
      <ModelPickerModal
        title="AI › Worker model › Backlog"
        models={models}
        current={{ provider: "acme", modelId: "fast-1" }}
        defaultLabel={NO_OVERRIDE_LABEL}
        onSave={onSave}
        onClose={vi.fn()}
      />,
    );
    expect(tui.frame()).toContain("No override");
    expect(tui.frame()).not.toContain("Pi default");
    await tui.type("No override");
    await tui.press(keys.enter);
    expect(onSave).toHaveBeenCalledWith(null);
  });

  it("goes back from the thinking levels with esc, then closes", async () => {
    const { tui, onClose } = await open();
    await tui.type("deep");
    await tui.press(keys.enter, keys.escape);
    expect(tui.frame()).not.toContain("Thinking");
    expect(onClose).not.toHaveBeenCalled();
    await tui.press(keys.escape);
    expect(onClose).toHaveBeenCalledOnce();
  });
});
