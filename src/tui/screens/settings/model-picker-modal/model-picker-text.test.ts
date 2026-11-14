import { describe, expect, it } from "vitest";
import { levelChoice, modelLabels, pickerHints, pickerId } from "./model-picker-text.js";

const deep = { provider: "acme", modelId: "deep-1", name: "Deep One", thinkingLevels: ["low", "high"] };

describe("modelPickerText", () => {
  it("labels each model by its id and its own name", () => {
    expect(pickerId(deep)).toBe("acme/deep-1");
    expect(modelLabels([deep, { ...deep, modelId: "x", name: "x" }])).toEqual({
      "": "Pi default",
      "acme/deep-1": "acme/deep-1 · Deep One",
      "acme/x": "acme/x",
    });
    expect(modelLabels([deep], "No override")[""]).toBe("No override");
  });

  it("gives the keys of each step", () => {
    expect(pickerHints(false).map((h) => h.key)).toContain("ctrl+l");
    expect(pickerHints(true).map((h) => h.description)).toContain("back");
  });

  it("keeps the thinking level only when one is chosen", () => {
    expect(levelChoice(deep, "")).toEqual({ provider: "acme", modelId: "deep-1" });
    expect(levelChoice(deep, "high")).toEqual({ provider: "acme", modelId: "deep-1", thinkingLevel: "high" });
  });
});
