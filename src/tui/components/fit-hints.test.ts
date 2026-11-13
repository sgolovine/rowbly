import { describe, expect, it } from "vitest";
import { fitHints, hintsWidth } from "./fit-hints.js";

const hints = [
  { key: "n", description: "new" },
  { key: "e", description: "edit" },
  { key: "d", description: "delete" },
];
const esc = { key: "esc", description: "back" };

describe("hintsWidth", () => {
  it("counts each hint and the two-space gaps between them", () => {
    expect(hintsWidth([])).toBe(0);
    expect(hintsWidth(hints.slice(0, 1))).toBe(5);
    expect(hintsWidth(hints)).toBe("n new  e edit  d delete".length);
  });

  it("counts a multi-unit character as one column", () => {
    expect(hintsWidth([{ key: "↑/↓", description: "move" }])).toBe(8);
  });
});

describe("fitHints", () => {
  it("keeps all the hints when they fit", () => {
    expect(fitHints(hints, 100)).toEqual(hints);
  });

  it("drops hints from the end until they fit", () => {
    expect(fitHints(hints, 13)).toEqual(hints.slice(0, 2));
  });

  it("keeps a last esc hint and drops the ones before it", () => {
    expect(fitHints([...hints, esc], 14)).toEqual([hints[0], esc]);
  });

  it("always keeps the first hint, and a last esc", () => {
    expect(fitHints(hints, 0)).toEqual([hints[0]]);
    expect(fitHints([...hints, esc], 0)).toEqual([hints[0], esc]);
  });
});
