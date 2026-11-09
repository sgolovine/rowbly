import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { cleanup } from "ink-testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { recordProject } from "../../../services/knownProject/knownProject.js";
import { initProject } from "../../../services/project/project.js";
import { useTempDir } from "../../../services/testProject/testProject.js";
import { keys, renderTui, settle } from "../../testing/index.js";
import { ProjectSwitcher } from "./ProjectSwitcher.js";

afterEach(cleanup);

describe("ProjectSwitcher", () => {
  const dir = useTempDir();
  const ctx = () => ({ home: dir.path });

  /** Records real Projects named `names`, the last one as the most recent. Returns their roots. */
  async function seed(...names: string[]) {
    const roots = [];
    for (const name of names) {
      const root = join(dir.path, name);
      await mkdir(root);
      await initProject({ name, key: "AB" }, { cwd: root });
      await recordProject({ path: root, name }, ctx());
      roots.push(root);
    }
    return roots;
  }

  async function open(current?: string) {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    const tui = await renderTui(
      <ProjectSwitcher ctx={ctx()} current={current} onSelect={onSelect} onClose={onClose} />,
    );
    await settle(50);
    await tui.press();
    return { tui, onSelect, onClose };
  }

  it("says so when there are no Projects", async () => {
    const { tui } = await open();
    expect(tui.frame()).toContain("No Projects yet.");
  });

  it("marks the open Project and starts on the most recent other Project", async () => {
    const [older, newer] = await seed("older", "newer");
    const { tui, onSelect } = await open(newer);
    expect(tui.frame()).toMatch(/newer · current/);
    expect(tui.frame()).toMatch(/▌ older/);
    await tui.press(keys.enter);
    expect(onSelect).toHaveBeenCalledWith(older);
  });

  it("switches on a click", async () => {
    const [older] = await seed("older", "newer");
    const { tui, onSelect } = await open();
    await tui.click("older");
    expect(onSelect).toHaveBeenCalledWith(older);
  });

  it("does not switch to a missing Project", async () => {
    await recordProject({ path: join(dir.path, "gone"), name: "gone" }, ctx());
    const { tui, onSelect } = await open();
    expect(tui.frame()).toMatch(/gone · missing/);
    await tui.press(keys.enter);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("closes on esc", async () => {
    const { tui, onClose } = await open();
    await tui.press(keys.escape);
    expect(onClose).toHaveBeenCalledOnce();
  });
});
