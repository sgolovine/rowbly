import { cleanup } from "ink-testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useTestProject } from "../../../../services/test-project/test-project.js";
import { keys, renderTui } from "../../../testing/index.js";
import { GitSection } from "./git-section.js";

vi.mock("@earendil-works/pi-coding-agent", () => {
  throw new Error("The Git settings must not load Pi");
});
vi.mock("../../../../services/agent-auth/agent-auth.js", () => {
  throw new Error("The Git settings must not load agent-auth");
});

afterEach(cleanup);

const OTHER = { version: 1, maxWorkers: 3, workerModel: { provider: "faux", modelId: "test" } };

describe("GitSection", () => {
  const project = useTestProject();

  async function open(settings?: unknown) {
    if (settings) {
      await project.write("factory.json", JSON.stringify(settings));
    }
    const onChange = vi.fn();
    const tui = await renderTui(<GitSection ctx={project.ctx} onChange={onChange} />);
    await vi.waitFor(async () => {
      await tui.press();
      expect(tui.frame()).toContain("Sync interval");
      expect(tui.frame()).not.toContain("—");
    });
    return { tui, onChange };
  }

  async function saved() {
    return JSON.parse(await project.read("factory.json"));
  }

  function toasts(tui: Awaited<ReturnType<typeof open>>["tui"]) {
    return tui.toasts.list().map((toast) => toast.message);
  }

  async function backspace(tui: Awaited<ReturnType<typeof open>>["tui"], count: number) {
    await tui.press(...Array.from({ length: count }, () => keys.backspace));
  }

  it("shows the defaults without a git section", async () => {
    const { tui } = await open();
    const frame = tui.frame();
    expect(frame).toMatch(/Commit author\s+Edit\s+a/);
    expect(frame).toContain("Git config identity");
    expect(frame).toMatch(/Commit message\s+Edit\s+m/);
    expect(frame).toContain("chore(rowbly): record project changes after scan");
    expect(frame).toMatch(/Periodic push\s+Toggle\s+p[\s\S]*off/);
    expect(frame).toMatch(/Periodic pull\s+Toggle\s+u[\s\S]*off/);
    expect(frame).toMatch(/Sync interval\s+Edit\s+i/);
    expect(frame).toContain("300 seconds");
  });

  it("shows the values of the git section", async () => {
    const git = {
      authorName: "Factory Bot",
      authorEmail: "bot@example.com",
      commitMessage: "chore: board",
      push: true,
      pull: true,
      syncIntervalSeconds: 120,
    };
    const { tui } = await open({ ...OTHER, git });
    const frame = tui.frame();
    expect(frame).toContain("Factory Bot <bot@example.com>");
    expect(frame).toContain("chore: board");
    expect(frame).toMatch(/Periodic push[\s\S]*on[\s\S]*Periodic pull/);
    expect(frame).not.toMatch(/\boff\b/);
    expect(frame).toContain("120 seconds");
  });

  it("saves the author and keeps the other keys, then a toast and onChange follow", async () => {
    const { tui, onChange } = await open({ ...OTHER, git: { x: 1, push: true } });
    await tui.press("a");
    expect(tui.frame()).toContain("Git › Commit author");
    await tui.type("Factory Bot <bot@example.com>");
    await tui.press(keys.enter);
    await vi.waitFor(() => expect(toasts(tui)).toContain("Saved the commit author: Factory Bot <bot@example.com>"));
    expect(await saved()).toEqual({
      ...OTHER,
      git: { x: 1, push: true, authorName: "Factory Bot", authorEmail: "bot@example.com" },
    });
    expect(tui.frame()).not.toContain("Git › Commit author");
    expect(tui.frame()).toContain("Factory Bot <bot@example.com>");
    expect(onChange).toHaveBeenCalledOnce();
  });

  it("shows the error of an author that is not Name <email>, and does not change the file", async () => {
    const { tui, onChange } = await open({ ...OTHER, git: { push: true } });
    const before = await project.read("factory.json");
    await tui.press("a");
    await tui.type("Factory Bot");
    await tui.press(keys.enter);
    await vi.waitFor(() => expect(tui.frame()).toContain('Use "Name <email>" for the commit author'));
    expect(tui.frame()).toContain("Git › Commit author");
    expect(await project.read("factory.json")).toBe(before);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("saves the message, and an empty author or message removes the value", async () => {
    const git = { authorName: "Bot", authorEmail: "bot@example.com", pull: true };
    const { tui, onChange } = await open({ ...OTHER, git });
    await tui.press("m");
    await tui.type("chore: board");
    await tui.press(keys.enter);
    await vi.waitFor(async () => expect((await saved()).git.commitMessage).toBe("chore: board"));
    await vi.waitFor(() => expect(tui.frame()).not.toContain("Git › Commit message"));

    await tui.press("m");
    await backspace(tui, "chore: board".length);
    await tui.press(keys.enter);
    await vi.waitFor(() => expect(toasts(tui)).toContain("Cleared the commit message"));

    await tui.press("a");
    await backspace(tui, "Bot <bot@example.com>".length);
    await tui.press(keys.enter);
    await vi.waitFor(() => expect(toasts(tui)).toContain("Cleared the commit author"));
    expect(await saved()).toEqual({ ...OTHER, git: { pull: true } });
    expect(tui.frame()).toContain("Git config identity");
    expect(onChange).toHaveBeenCalledTimes(3);
  });

  it("toggles push and pull with their keys and with a click", async () => {
    const { tui, onChange } = await open({ ...OTHER, git: { commitMessage: "chore: board" } });
    await tui.press("p");
    await vi.waitFor(() => expect(toasts(tui)).toContain("Periodic push on"));
    expect(await saved()).toEqual({ ...OTHER, git: { commitMessage: "chore: board", push: true } });
    expect(tui.frame()).toMatch(/Periodic push\s+Toggle\s+p\s*│\s*│ on/);

    await tui.press("u");
    await vi.waitFor(() => expect(toasts(tui)).toContain("Periodic pull on"));
    expect((await saved()).git).toEqual({ commitMessage: "chore: board", push: true, pull: true });

    await tui.click("Toggle");
    await vi.waitFor(async () => expect((await saved()).git.push).toBe(false));
    await vi.waitFor(() => expect(toasts(tui)).toContain("Periodic push off"));
    expect(onChange).toHaveBeenCalledTimes(3);
  });

  it("saves the sync interval, and rejects a value out of range or not whole", async () => {
    const { tui } = await open({ ...OTHER, git: { push: true } });
    const before = await project.read("factory.json");
    await tui.press("i");
    await backspace(tui, 3);
    await tui.type("59");
    await tui.press(keys.enter);
    await vi.waitFor(() => expect(tui.frame()).toContain("must be a whole number from 60 to 86400"));
    await backspace(tui, 2);
    await tui.type("90.5");
    await tui.press(keys.enter);
    await vi.waitFor(() => expect(tui.frame()).toContain("must be a whole number from 60 to 86400"));
    await backspace(tui, 4);
    await tui.type("86401");
    await tui.press(keys.enter);
    await vi.waitFor(() => expect(tui.frame()).toContain("must be a whole number from 60 to 86400"));
    expect(await project.read("factory.json")).toBe(before);

    await backspace(tui, 5);
    await tui.type("600");
    await tui.press(keys.enter);
    await vi.waitFor(() => expect(toasts(tui)).toContain("Saved the sync interval: 600 seconds"));
    expect(await saved()).toEqual({ ...OTHER, git: { push: true, syncIntervalSeconds: 600 } });
    expect(tui.frame()).toContain("600 seconds");
  });
});
