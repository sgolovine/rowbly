import { cleanup } from "ink-testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderTui } from "../../../testing/index.js";
import { AiButtons, type AiButtonsProps } from "./ai-buttons.js";

afterEach(cleanup);

function props(overrides: Partial<AiButtonsProps> = {}): AiButtonsProps {
  return {
    canSignIn: true,
    canSignOut: true,
    ready: true,
    idle: true,
    onSignIn: vi.fn(),
    onSignOut: vi.fn(),
    onModel: vi.fn(),
    onLimit: vi.fn(),
    onReload: vi.fn(),
    ...overrides,
  };
}

describe("AiButtons", () => {
  it("shows the model buttons only after the providers load", async () => {
    const tui = await renderTui(<AiButtons {...props({ ready: false, canSignIn: false, canSignOut: false })} />);

    expect(tui.frame()).not.toContain("Supervisor model");
    expect(tui.frame()).not.toContain("Sign in");
    expect(tui.frame()).toContain("Worker limit");
    expect(tui.frame()).toContain("Reload");
  });

  it("gives the role of a model button", async () => {
    const p = props();
    const tui = await renderTui(<AiButtons {...p} />);

    await tui.click("Worker model");

    expect(p.onModel).toHaveBeenCalledWith("worker");
  });
});
