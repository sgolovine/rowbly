import { cleanup } from "ink-testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { keys, renderTui } from "../../../testing/index.js";
import { AuthPromptView } from "./auth-prompt.js";

afterEach(cleanup);

describe("AuthPromptView", () => {
  it("masks a secret", async () => {
    const tui = await renderTui(
      <AuthPromptView
        pending={{ prompt: { type: "secret", message: "Paste the key" }, resolve: vi.fn() }}
        text="abc"
        onText={vi.fn()}
        width={40}
        active
      />,
    );

    expect(tui.frame()).toContain("Paste the key");
    expect(tui.frame()).toContain("•••");
    expect(tui.frame()).not.toContain("abc");
  });

  it("answers a choice with enter", async () => {
    const resolve = vi.fn();
    const tui = await renderTui(
      <AuthPromptView
        pending={{
          prompt: { type: "select", message: "Pick", options: [{ id: "a", label: "Alpha" }] },
          resolve,
        }}
        text=""
        onText={vi.fn()}
        width={40}
        active
      />,
    );

    await tui.press(keys.enter);

    expect(resolve).toHaveBeenCalledWith("a");
  });
});
