import { writeFile } from "node:fs/promises";
import { Text } from "ink";
import { cleanup } from "ink-testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createStory } from "../../services/story/story.js";
import { useTestProject } from "../../services/test-project/test-project.js";
import { renderTui, settle } from "../testing/index.js";
import { useFactoryStateChanges } from "./use-factory-state-changes.js";
import { useStoryChanges } from "./use-story-changes.js";

afterEach(cleanup);

function Probe({ root, onState, onStories }: { root?: string; onState(): void; onStories(): void }) {
  useFactoryStateChanges(root, onState);
  useStoryChanges(root, onStories);
  return <Text>watching</Text>;
}

describe("useFactoryStateChanges", () => {
  const project = useTestProject();

  it("calls back for the state file only, and the Story watch ignores the state file", async () => {
    const onState = vi.fn();
    const onStories = vi.fn();
    const tui = await renderTui(<Probe root={project.paths.root} onState={onState} onStories={onStories} />);
    await settle(50);
    await writeFile(project.paths.stateFile, "{}");
    await vi.waitFor(() => expect(onState).toHaveBeenCalledOnce());
    await settle(200);
    expect(onStories).not.toHaveBeenCalled();
    await createStory({ title: "T" }, project.ctx);
    await vi.waitFor(() => expect(onStories).toHaveBeenCalled());
    expect(onState).toHaveBeenCalledOnce();
    tui.unmount();
    await writeFile(project.paths.stateFile, '{"version":1}');
    await settle(250);
    expect(onState).toHaveBeenCalledOnce();
  });

  it("watches nothing without a root", async () => {
    const onState = vi.fn();
    await renderTui(<Probe onState={onState} onStories={() => {}} />);
    await writeFile(project.paths.stateFile, "{}");
    await settle(250);
    expect(onState).not.toHaveBeenCalled();
  });
});
