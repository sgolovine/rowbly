import { cleanup } from "ink-testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderTui } from "../../../testing/index.js";
import { FactoryButtons, type FactoryButtonsProps } from "./factory-buttons.js";

afterEach(cleanup);

function props(overrides: Partial<FactoryButtonsProps> = {}): FactoryButtonsProps {
  return {
    live: false,
    canLaunch: true,
    stopping: false,
    busy: null,
    canStart: true,
    canStop: false,
    canInspect: false,
    idle: true,
    onStart: vi.fn(),
    onInspect: vi.fn(),
    onHistory: vi.fn(),
    onStop: vi.fn(),
    ...overrides,
  };
}

describe("FactoryButtons", () => {
  it("offers start and history for a stopped factory", async () => {
    const tui = await renderTui(<FactoryButtons {...props()} />);

    expect(tui.frame()).toContain("Start");
    expect(tui.frame()).toContain("History");
    expect(tui.frame()).not.toContain("Stop");
    expect(tui.frame()).not.toContain("Supervisor");
  });

  it("offers the supervisor, the AI settings and stop for a live factory", async () => {
    const tui = await renderTui(
      <FactoryButtons
        {...props({ live: true, canStart: false, canStop: true, canInspect: true, onAiSettings: vi.fn() })}
      />,
    );

    expect(tui.frame()).not.toContain("Start");
    expect(tui.frame()).toContain("Supervisor");
    expect(tui.frame()).toContain("AI settings");
    expect(tui.frame()).toContain("Stop");
  });

  it("shows the progress of a stop", async () => {
    const tui = await renderTui(<FactoryButtons {...props({ live: true, stopping: true, canStart: false })} />);

    expect(tui.frame()).toContain("Stop…");
  });

  it("offers the warnings of a live factory with w, and a click opens them", async () => {
    const onWarnings = vi.fn();
    const tui = await renderTui(
      <FactoryButtons {...props({ live: true, canStart: false, canWarnings: true, onWarnings })} />,
    );

    expect(tui.frame()).toMatch(/Warnings\s+w/);

    await tui.click("Warnings");

    expect(onWarnings).toHaveBeenCalledOnce();
  });
});
