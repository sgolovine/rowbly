import { cleanup } from "ink-testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderTui } from "../../../testing/index.js";
import { CustomFieldRow } from "./custom-field-row.js";

afterEach(cleanup);

describe("CustomFieldRow", () => {
  it("shows the name, the key and the type, and the options of a select field", async () => {
    const tui = await renderTui(
      <CustomFieldRow
        field={{ key: "size", label: "Size", type: "select", options: ["S", "M"] }}
        selected
        active
        labelWidth={8}
        keyWidth={8}
        onClick={vi.fn()}
      />,
    );

    expect(tui.frame()).toMatch(/Size\s+size\s+select: S, M/);
  });

  it("calls onClick on a click", async () => {
    const onClick = vi.fn();
    const tui = await renderTui(
      <CustomFieldRow
        field={{ key: "url", label: "Link", type: "url" }}
        selected={false}
        active
        labelWidth={6}
        keyWidth={6}
        onClick={onClick}
      />,
    );

    await tui.click("Link");

    expect(onClick).toHaveBeenCalledOnce();
  });
});
