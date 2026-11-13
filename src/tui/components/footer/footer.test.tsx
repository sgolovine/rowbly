import { cleanup } from "ink-testing-library";
import { afterEach, describe, expect, it } from "vitest";
import pkg from "../../../../package.json" with { type: "json" };
import { renderTui } from "../../testing/index.js";
import { Footer } from "./footer.js";

afterEach(cleanup);

const hints = [
  { key: "n", description: "new story" },
  { key: "x", description: "archive", secondary: true },
];

describe("Footer", () => {
  it("shows the primary hints, help and the version, but not the secondary hints", async () => {
    const tui = await renderTui(<Footer hints={hints} atRoot={false} />);
    const frame = tui.frame();
    expect(frame).toContain("n new story");
    expect(frame).not.toContain("archive");
    expect(frame).toContain("? help");
    expect(frame).toContain(`v${pkg.version}`);
    expect(frame).not.toContain("q quit");
  });

  it("shows q quit at the root, pinned right before the version", async () => {
    const tui = await renderTui(<Footer hints={hints} atRoot />);
    expect(tui.frame()).toMatch(new RegExp(`\\? help {2}q quit {2}v${pkg.version.replaceAll(".", "\\.")}$`));
  });
});
