import { describe, expect, it } from "vitest";
import { headerFit } from "./header-fit.js";

const STOPPED = { status: { version: 1, phase: "stopped" } } as const;

describe("headerFit", () => {
  it("keeps all parts in a wide header", () => {
    expect(headerFit({ width: 160, project: "Rowbly", factory: STOPPED })).toEqual({
      narrow: false,
      name: "Rowbly",
      compact: false,
      factoryShort: false,
      factoryKey: true,
      factoryShown: true,
    });
  });

  it("cuts a long Project name to its room", () => {
    expect(headerFit({ width: 160, project: "A".repeat(40), factory: undefined }).name).toBe(`${"A".repeat(23)}…`);
    expect(headerFit({ width: 50, project: "A".repeat(40), factory: undefined }).name).toBe(`${"A".repeat(11)}…`);
  });

  it("makes the finder compact, then removes the Factory Button, in a narrow header", () => {
    const narrow = headerFit({ width: 50, project: "Rowbly", factory: STOPPED });

    expect(narrow.narrow).toBe(true);
    expect(narrow.compact).toBe(true);
    expect(narrow.factoryShown).toBe(false);
  });

  it("fits each row when there is no Project", () => {
    const fit = headerFit({ width: 70, project: undefined, factory: STOPPED });

    expect(fit.name).toBe("");
    expect(fit.compact).toBe(false);
    expect(fit.factoryShown).toBe(true);
  });
});
