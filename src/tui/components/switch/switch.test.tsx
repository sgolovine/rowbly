import { cleanup } from "ink-testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderTui } from "../../testing/index.js";
import { Switch } from "./switch.js";

afterEach(cleanup);

describe("Switch", () => {
  it("shows the track and the label of its state", async () => {
    expect((await renderTui(<Switch on />)).frame()).toBe("━━● On");
    expect((await renderTui(<Switch on={false} />)).frame()).toBe("●── Off");
  });

  it("shows custom labels", async () => {
    const props = { onLabel: "Enabled", offLabel: "Disabled" };
    expect((await renderTui(<Switch on {...props} />)).frame()).toContain("Enabled");
    expect((await renderTui(<Switch on={false} {...props} />)).frame()).toContain("Disabled");
  });

  it("toggles on a click", async () => {
    const onChange = vi.fn();
    const tui = await renderTui(<Switch on onChange={onChange} />);
    await tui.click("On");
    expect(onChange).toHaveBeenCalledWith(false);
  });

  it("ignores a click while not clickable", async () => {
    const onChange = vi.fn();
    const tui = await renderTui(<Switch on={false} onChange={onChange} clickable={false} />);
    await tui.click("Off");
    expect(onChange).not.toHaveBeenCalled();
  });
});
