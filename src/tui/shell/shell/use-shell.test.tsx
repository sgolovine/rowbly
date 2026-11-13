import { Text } from "ink";
import { cleanup } from "ink-testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { createStory } from "../../../services/story/story.js";
import { useTestProject } from "../../../services/test-project/test-project.js";
import type { ServiceContext } from "../../../services/workspace/workspace.js";
import { keys, renderTui, settle } from "../../testing/index.js";
import { type ShellModel, useShell } from "./use-shell.js";

afterEach(cleanup);

function modelText(model: ShellModel): string {
  const selected = model.env.view.row?.id ?? "-";

  return `${model.overlay?.kind ?? "no overlay"} · ${selected} · ${model.hints.map((hint) => hint.key).join(" ")}`;
}

/** Shows the overlay, the selected row and the keys of the shell. */
function Probe({ ctx }: { ctx: ServiceContext }) {
  return <Text>{modelText(useShell(ctx))}</Text>;
}

describe("useShell", () => {
  const project = useTestProject();

  it("moves the cursor and opens an overlay with the keys of the shell", async () => {
    await createStory({ title: "One" }, project.ctx);
    await createStory({ title: "Two" }, project.ctx);
    const tui = await renderTui(<Probe ctx={project.ctx} />);

    await settle(100);
    await tui.press();
    expect(tui.frame()).toContain("no overlay · ROW-01");

    await tui.press(keys.down);
    expect(tui.frame()).toContain("no overlay · ROW-02");

    await tui.press("?");
    expect(tui.frame()).toContain("help · ROW-02");
  });
});
