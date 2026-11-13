import { Box } from "ink";
import { cleanup } from "ink-testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { renderTui } from "../../../testing/index.js";
import { FactoryStatusLine } from "./FactoryStatusLine.js";

afterEach(cleanup);

const path = "/repo/.rowbly/state.json";

describe("FactoryStatusLine", () => {
  it("shows nothing for a valid file", async () => {
    const tui = await renderTui(<FactoryStatusLine activity={{ path, status: "ok", stories: {} }} />);
    expect(tui.frame()).toBe("");
  });

  it("shows nothing for a missing file, because the header shows the state of the factory", async () => {
    const tui = await renderTui(<FactoryStatusLine activity={{ path, status: "missing", stories: {} }} />);
    expect(tui.frame()).toBe("");
  });

  it("shows a warning with the path and the reason for a file that Rowbly cannot use", async () => {
    const activity = { path, status: "unavailable", message: "Unsupported version 2", stories: {} } as const;
    const tui = await renderTui(<FactoryStatusLine activity={activity} />);
    expect(tui.frame()).toBe(`! Factory activity is unavailable: ${path}: Unsupported version 2`);
  });

  it("shows a warning for an incomplete file", async () => {
    const activity = { path, status: "incomplete", message: "Missing scan", stories: {} } as const;
    const tui = await renderTui(<FactoryStatusLine activity={activity} />);
    expect(tui.frame()).toBe(`! Factory activity is incomplete: ${path}: Missing scan`);
  });

  it("stays on one line in a narrow region", async () => {
    const activity = { path, status: "unavailable", message: "The file is not valid JSON", stories: {} } as const;
    const tui = await renderTui(
      <Box width={30}>
        <FactoryStatusLine activity={activity} />
      </Box>,
    );
    expect(tui.frame().split("\n")).toHaveLength(1);
  });
});
