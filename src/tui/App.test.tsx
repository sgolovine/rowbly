import { EventEmitter } from "node:events";
import { stripVTControlCharacters } from "node:util";
import { cleanup, render } from "ink-testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useTestProject } from "../services/testProject/testProject.js";
import { App } from "./App.js";
import { createToastStore } from "./hooks/index.js";

afterEach(cleanup);

describe("App", () => {
  const project = useTestProject();

  it("shows the shell of the project in the providers", async () => {
    const ink = render(
      <App toasts={createToastStore()} mouse={new EventEmitter()} ctx={project.ctx} fullscreen={false} />,
    );
    // The project loads from disk, so wait for the shell instead of a fixed time.
    await vi.waitFor(() => {
      const frame = stripVTControlCharacters(ink.lastFrame() ?? "");
      expect(frame).toContain("Find Stories");
      expect(frame).toContain("+ New Story");
      expect(frame).toContain("All Stages");
      expect(frame).toContain("Rowbly › All Stages");
    });
  });
});
