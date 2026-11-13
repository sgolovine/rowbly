import { Text } from "ink";
import { cleanup } from "ink-testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { listKnownProjects } from "../../../services/known-project/known-project.js";
import { createStory } from "../../../services/story/story.js";
import { useTempDir, useTestProject } from "../../../services/test-project/test-project.js";
import type { ServiceContext } from "../../../services/workspace/workspace.js";
import { renderTui, settle } from "../../testing/index.js";
import { type ShellData, useShellData } from "./use-shell-data.js";

afterEach(cleanup);

function boardText(shell: ShellData): string {
  if (shell.data.loading) {
    return "loading";
  }

  return shell.data.data ? `${shell.data.data.project.projectName}: ${shell.data.data.stories.length}` : "none";
}

/** Shows the board, and gives the last data to the test. */
function Probe({ ctx, onData }: { ctx: ServiceContext; onData(shell: ShellData): void }) {
  const shell = useShellData(ctx);

  onData(shell);

  return <Text>{boardText(shell)}</Text>;
}

describe("useShellData", () => {
  const project = useTestProject();
  const empty = useTempDir();

  it("reads the board, records the Project and reads the board again on reload", async () => {
    const seen: ShellData[] = [];
    const tui = await renderTui(<Probe ctx={project.ctx} onData={(shell) => seen.push(shell)} />);

    await settle(100);
    expect(tui.frame()).toContain("Rowbly: 0");
    expect((await listKnownProjects({})).some((known) => known.path === project.ctx.cwd)).toBe(true);

    await createStory({ title: "One" }, project.ctx);
    seen.at(-1)?.reload();
    await settle(100);
    await tui.press();
    expect(tui.frame()).toContain("Rowbly: 1");
  });

  it("gives null in a directory without a Project", async () => {
    const tui = await renderTui(<Probe ctx={{ cwd: empty.path }} onData={() => {}} />);

    await settle(100);
    await tui.press();
    expect(tui.frame()).toContain("none");
  });
});
