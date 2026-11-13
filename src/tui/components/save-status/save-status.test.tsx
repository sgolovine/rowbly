import { cleanup } from "ink-testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { renderTui } from "../../testing/index.js";
import { SaveStatus } from "./save-status.js";

afterEach(cleanup);

describe("SaveStatus", () => {
  it("shows nothing before there is something to save", async () => {
    const tui = await renderTui(<SaveStatus save={{ kind: "idle" }} dirty={false} />);
    expect(tui.frame()).toBe("");
  });

  it("shows unsaved changes", async () => {
    const tui = await renderTui(<SaveStatus save={{ kind: "saved" }} dirty />);
    expect(tui.frame()).toBe("unsaved");
  });

  it("shows a save in progress before unsaved changes", async () => {
    const tui = await renderTui(<SaveStatus save={{ kind: "saving" }} dirty />);
    expect(tui.frame()).toBe("saving…");
  });

  it("shows the message of a failed save", async () => {
    const tui = await renderTui(<SaveStatus save={{ kind: "failed", message: "disk full" }} dirty />);
    expect(tui.frame()).toBe("not saved: disk full");
  });

  it("shows a saved text", async () => {
    const tui = await renderTui(<SaveStatus save={{ kind: "saved" }} dirty={false} />);
    expect(tui.frame()).toBe("saved");
  });
});
