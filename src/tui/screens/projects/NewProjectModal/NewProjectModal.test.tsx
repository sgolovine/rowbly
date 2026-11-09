import { mkdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { cleanup } from "ink-testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getProject, initProject } from "../../../../services/project/project.js";
import { listStages } from "../../../../services/stage/stage.js";
import { useTempDir } from "../../../../services/testProject/testProject.js";
import { keys, renderTui, settle } from "../../../testing/index.js";
import { NewProjectModal } from "./NewProjectModal.js";

afterEach(cleanup);

describe("NewProjectModal", () => {
  const dir = useTempDir();

  async function setup(cwd = dir.path) {
    const onCreated = vi.fn();
    const onClose = vi.fn();
    const tui = await renderTui(<NewProjectModal ctx={{ cwd }} onCreated={onCreated} onClose={onClose} />);
    return { tui, onCreated, onClose };
  }

  it("starts with the name of the directory", async () => {
    const frame = (await setup()).tui.frame();
    expect(frame).toContain("New Project");
    expect(frame).toContain(basename(dir.path));
  });

  it("creates the same Project as rowbly init, with the key from the directory's name", async () => {
    const cwd = join(dir.path, "my-cool-app");
    await mkdir(cwd);
    const { tui, onCreated } = await setup(cwd);
    await tui.press(keys.ctrl("s"));
    await settle(50);
    const project = await getProject({ cwd });
    expect(project).toMatchObject({ projectName: "my-cool-app", projectKey: "MCA" });
    expect((await listStages({ cwd })).map((s) => s.key)).toEqual(["BACKLOG", "DONE"]);
    expect(onCreated).toHaveBeenCalledWith(project);
    expect(tui.toasts.list().map((t) => t.message)).toEqual(["Created my-cool-app (MCA)"]);
  });

  it("fills the key from the name, and keeps a key that you type", async () => {
    const { tui } = await setup();
    await tui.press(keys.backspace.repeat(basename(dir.path).length));
    await tui.type("Web Shop");
    await tui.press(keys.tab);
    expect(tui.frame()).toContain("WS");
    await tui.press(keys.backspace, keys.backspace);
    await tui.type("shop");
    await tui.press(keys.ctrl("s"));
    await settle(50);
    expect(await getProject({ cwd: dir.path })).toMatchObject({ projectName: "Web Shop", projectKey: "SHOP" });
  });

  it("shows an invalid key under its field", async () => {
    const { tui, onCreated } = await setup();
    await tui.press(keys.tab);
    await tui.press(keys.backspace.repeat(8));
    await tui.type("1 bad");
    await tui.press(keys.ctrl("s"));
    await settle(50);
    await tui.press();
    expect(onCreated).not.toHaveBeenCalled();
    expect(tui.toasts.list()).toEqual([]);
    expect(tui.frame()).toContain("must be uppercase");
  });

  it("shows a toast when the directory already has a Project", async () => {
    await initProject({ name: "Taken", key: "TK" }, { cwd: dir.path });
    const { tui, onCreated } = await setup();
    await tui.press(keys.ctrl("s"));
    await settle(50);
    expect(onCreated).not.toHaveBeenCalled();
    expect(
      tui.toasts
        .list()
        .map((t) => t.message)
        .join(),
    ).toContain("already exists");
  });

  it("closes with esc", async () => {
    const { tui, onClose } = await setup();
    await tui.press(keys.escape);
    expect(onClose).toHaveBeenCalled();
  });
});
