import { cleanup } from "ink-testing-library";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as clipboard from "../../../../services/clipboard/clipboard.js";
import { updateProject } from "../../../../services/project/project.js";
import { createSpec } from "../../../../services/spec/spec.js";
import { createStory } from "../../../../services/story/story.js";
import { useTestProject } from "../../../../services/test-project/test-project.js";
import type { KeyHint } from "../../../keymap.js";
import { keys, renderTui } from "../../../testing/index.js";
import { StoryModalBody, type StoryModalConfirm } from "./story-modal-body.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

interface Calls {
  submit(): void;
  close(): void;
  requestClose(): void;
  confirmDelete(): void;
}

/** Holds the confirmation state, as `StoryModal` does. */
function Host({
  cwd,
  calls,
  onHints = () => {},
}: {
  cwd: string;
  calls: Calls;
  onHints?(hints: readonly KeyHint[]): void;
}) {
  const [confirming, setConfirming] = useState<StoryModalConfirm>(null);
  return (
    <StoryModalBody
      ctx={{ cwd }}
      storyId="ROW-01"
      fields={[{ name: "title", label: "Title", kind: "text", required: true }]}
      initialValues={{ title: "Login" }}
      onSubmit={calls.submit}
      onClose={calls.close}
      onRequestClose={calls.requestClose}
      onDelete={{ title: "Delete Story", message: "Delete it?", onConfirm: calls.confirmDelete }}
      confirming={confirming}
      onConfirming={setConfirming}
      onHints={onHints}
    />
  );
}

describe("StoryModalBody", () => {
  const project = useTestProject();

  beforeEach(async () => {
    await updateProject({ features: { specs: true } }, project.ctx);
    await createStory({ title: "Login" }, project.ctx);
    await createSpec({ title: "API", stories: ["ROW-01"], body: "The API text" }, project.ctx);
  });

  async function setup() {
    const calls = { submit: vi.fn(), close: vi.fn(), requestClose: vi.fn(), confirmDelete: vi.fn() };
    const tui = await renderTui(<Host cwd={project.ctx.cwd as string} calls={calls} />);
    await vi.waitFor(async () => {
      await tui.press();
      expect(tui.frame()).toContain("Specs 1");
    });
    return { tui, ...calls };
  }

  it("shows the General tab first and counts the specs on the Specs tab", async () => {
    const { tui } = await setup();
    expect(tui.frame()).toContain("General");
    expect(tui.frame()).toContain("Specs 1");
    expect(tui.frame()).toContain("Title");
    expect(tui.frame()).not.toContain("The API text");
  });

  it("keeps a valid clipboard fallback across the Story tabs", async () => {
    vi.spyOn(clipboard, "readClipboardImage").mockResolvedValue({ reason: "no-display" });
    const { tui } = await setup();
    for (const tab of ["General", "Specs 1", "Attachments", "Threads"]) {
      await tui.click(tab);
      await tui.press(keys.ctrl("v"));
      const toast = tui.toasts.list().at(-1);
      expect(toast?.message).toContain("rowbly add-attachment ROW-01 <file.png>");
      expect(toast?.message).not.toContain(project.ctx.cwd);
    }
  });

  it("changes the tab with shift+tab and with a click", async () => {
    const { tui } = await setup();
    await tui.press(keys.shiftTab);
    expect(tui.frame()).toContain("The API text");
    await tui.click("General");
    expect(tui.frame()).not.toContain("The API text");
    await tui.click("Specs 1");
    expect(tui.frame()).toContain("The API text");
  });

  it("saves the General tab with ctrl+s", async () => {
    const { tui, submit } = await setup();
    await tui.type("!");
    await tui.press(keys.ctrl("s"));
    await vi.waitFor(() => expect(submit).toHaveBeenCalledWith({ title: "Login!" }, []));
  });

  it("saves the Story while a spec has text that is not written yet", async () => {
    const { tui, submit } = await setup();
    await tui.press(keys.shiftTab, keys.enter);
    await tui.type("!");
    await tui.press(keys.escape, keys.shiftTab, keys.ctrl("s"));
    await vi.waitFor(() => expect(submit).toHaveBeenCalled());
    expect(tui.toasts.list()).toEqual([]);
  });

  it("keeps the text of the form when the tab changes", async () => {
    const { tui } = await setup();
    await tui.type("!");
    await tui.press(keys.shiftTab, keys.shiftTab, keys.shiftTab, keys.shiftTab);
    expect(tui.frame()).toContain("Login!");
  });

  it("asks before it deletes with ctrl+d on the General tab only", async () => {
    const { tui, confirmDelete } = await setup();
    await tui.press(keys.shiftTab, keys.ctrl("d"));
    expect(tui.frame()).not.toContain("Delete it?");
    await tui.press(keys.shiftTab, keys.shiftTab, keys.shiftTab, keys.ctrl("d"));
    expect(tui.frame()).toContain("Delete it?");
    await tui.press("y");
    expect(confirmDelete).toHaveBeenCalledOnce();
  });

  it("asks to close with esc, but esc in the spec text goes back to the list", async () => {
    const { tui, requestClose } = await setup();
    await tui.press(keys.shiftTab, keys.enter, keys.escape);
    expect(requestClose).not.toHaveBeenCalled();
    await tui.press(keys.escape);
    expect(requestClose).toHaveBeenCalledOnce();
  });

  it("shows the Threads tab last, reads it only on selection, and keeps the Specs and Attachments keys", async () => {
    const { tui } = await setup();
    expect(tui.frame()).toMatch(/General\s+Specs 1\s+Attachments\s+Threads/);
    expect(tui.frame()).not.toContain("No Threads");
    await tui.press(keys.shiftTab, keys.shiftTab, keys.shiftTab);
    await vi.waitFor(async () => {
      await tui.press();
      expect(tui.frame()).toContain("Threads 0");
    });
    expect(tui.frame()).toContain("No Threads");
    await tui.click("Specs 1");
    expect(tui.frame()).toContain("The API text");
    await tui.press("n");
    expect(tui.frame()).toContain("New Spec");
    await tui.press(keys.escape);
    await tui.click("Attachments");
    expect(tui.frame()).toContain("Attachments");
    expect(tui.frame()).not.toContain("No Threads");
  });

  it("puts the esc of a tab region last in the hints, where a narrow strip keeps it", async () => {
    let hints: readonly KeyHint[] = [];
    const calls = { submit: vi.fn(), close: vi.fn(), requestClose: vi.fn(), confirmDelete: vi.fn() };
    const tui = await renderTui(
      <Host
        cwd={project.ctx.cwd as string}
        calls={calls}
        onHints={(next) => {
          hints = next;
        }}
      />,
    );
    await vi.waitFor(async () => {
      await tui.press();
      expect(tui.frame()).toContain("Specs 1");
    });
    await tui.press(keys.shiftTab, keys.enter);
    await vi.waitFor(() => expect(hints.at(-1)).toEqual({ key: "esc", description: "back to specs" }));
    expect(hints.filter((hint) => hint.key === "esc")).toHaveLength(1);
  });
});
