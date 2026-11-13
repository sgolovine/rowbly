import { cleanup } from "ink-testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { renderTui } from "../../testing/index.js";
import { KeyHints } from "./key-hints.js";

afterEach(cleanup);

const hints = [
  { key: "n", description: "new" },
  { key: "e", description: "edit" },
  { key: "d", description: "delete" },
  { key: "esc", description: "back" },
];

describe("KeyHints", () => {
  it("shows each key and description, two spaces apart", async () => {
    const tui = await renderTui(<KeyHints hints={hints} />);
    expect(tui.frame()).toBe("n new  e edit  d delete  esc back");
  });

  it("leaves out the later hints that do not fit the width, but keeps a last esc", async () => {
    const tui = await renderTui(<KeyHints hints={hints} width={23} />);
    expect(tui.frame()).toBe("n new  e edit  esc back");
  });
});
