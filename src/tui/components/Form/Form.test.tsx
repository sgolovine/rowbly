import { cleanup } from "ink-testing-library";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NotFoundError, ValidationError } from "../../../services/errors/errors.js";
import { keys, renderTui } from "../../testing/index.js";
import { Form, type FormField, type FormProps, type FormValues } from "./Form.js";

afterEach(cleanup);

const FIELDS: FormField[] = [
  { name: "title", label: "Title", kind: "text", required: true },
  { name: "points", label: "Points", kind: "number" },
  { name: "due", label: "Due", kind: "date" },
  { name: "blocked", label: "Blocked", kind: "boolean" },
  {
    name: "stage",
    label: "Stage",
    kind: "select",
    options: ["BACKLOG", "DONE"],
    optionLabels: { BACKLOG: "Backlog", DONE: "Done" },
  },
  { name: "tags", label: "Tags", kind: "multiselect", options: ["ui", "cli", "docs"] },
];

const TITLE_ONLY: FormField[] = [{ name: "title", label: "Title", kind: "text" }];

function Controlled({ onChange }: { onChange(values: FormValues): void }) {
  const [values, setValues] = useState<FormValues>({ title: "a", extra: 1 });
  return (
    <Form
      fields={TITLE_ONLY}
      values={values}
      onChange={(next) => {
        setValues(next);
        onChange(next);
      }}
      onSubmit={() => {}}
    />
  );
}

function setup(props: Partial<FormProps> = {}) {
  const onSubmit = vi.fn<FormProps["onSubmit"]>();
  const tui = renderTui(<Form fields={FIELDS} onSubmit={onSubmit} {...props} />);
  return { onSubmit, tui };
}

/** The line of the frame that holds `text`. */
function lineOf(frame: string, text: string): string {
  return frame.split("\n").find((line) => line.includes(text)) ?? "";
}

describe("Form", () => {
  it("shows the labels, the required mark, the focus marker and the help of the focused field", async () => {
    const { tui } = setup();
    const frame = (await tui).frame();
    expect(frame).toContain("› Title*");
    expect(frame).toContain("  Points");
    expect(frame).toContain("type to edit");
    expect(lineOf(frame, "Due")).toContain("YYYY-MM-DD");
    expect(lineOf(frame, "Blocked")).toContain("[ ] no");
    expect(lineOf(frame, "Stage")).toContain("‹ — ›");
    expect(lineOf(frame, "Tags")).toContain("[ ] ui");
  });

  it("submits the parsed values on ctrl+s", async () => {
    const { tui, onSubmit } = setup();
    const t = await tui;
    await t.type("Fix bug");
    await t.press(keys.tab);
    await t.type("3");
    await t.press(keys.tab);
    await t.type("2026-01-31");
    await t.press(keys.ctrl("s"));
    expect(onSubmit).toHaveBeenCalledWith({
      title: "Fix bug",
      points: 3,
      due: "2026-01-31",
      blocked: false,
      stage: null,
      tags: [],
    });
  });

  it("moves focus with tab, enter and ↓, and back with shift+tab and ↑", async () => {
    const t = await setup().tui;
    await t.press(keys.tab);
    expect(t.frame()).toContain("› Points");
    await t.press(keys.enter);
    expect(t.frame()).toContain("› Due");
    await t.press(keys.down);
    expect(t.frame()).toContain("› Blocked");
    expect(t.frame()).toContain("space toggles");
    await t.press(keys.shiftTab);
    expect(t.frame()).toContain("› Due");
    await t.press(keys.up);
    expect(t.frame()).toContain("› Points");
  });

  it("moves with j/k on fields that are not typed", async () => {
    const t = await setup({ initialValues: {} }).tui;
    await t.press(keys.tab, keys.tab, keys.tab);
    await t.press("j");
    expect(t.frame()).toContain("› Stage");
    await t.press("k");
    expect(t.frame()).toContain("› Blocked");
  });

  it("toggles a boolean with space and ←/→", async () => {
    const t = await setup().tui;
    await t.press(keys.tab, keys.tab, keys.tab);
    await t.press(keys.space);
    expect(lineOf(t.frame(), "Blocked")).toContain("[x] yes");
    await t.press(keys.right);
    expect(lineOf(t.frame(), "Blocked")).toContain("[ ] no");
  });

  it("cycles a select with →/l/space and ←/h, and shows the option labels", async () => {
    const t = await setup().tui;
    await t.press(keys.tab, keys.tab, keys.tab, keys.tab);
    await t.press(keys.right);
    expect(lineOf(t.frame(), "Stage")).toContain("‹ Backlog ›");
    await t.press("l");
    expect(lineOf(t.frame(), "Stage")).toContain("‹ Done ›");
    await t.press(keys.space);
    expect(lineOf(t.frame(), "Stage")).toContain("‹ Backlog ›");
    await t.press("h");
    expect(lineOf(t.frame(), "Stage")).toContain("‹ Done ›");
  });

  it("picks multiselect options with ←/→ and space", async () => {
    const { tui, onSubmit } = setup({ initialValues: { title: "x" } });
    const t = await tui;
    await t.press(keys.tab, keys.tab, keys.tab, keys.tab, keys.tab);
    await t.press(keys.space, keys.right, keys.right, keys.space, keys.left);
    expect(lineOf(t.frame(), "Tags")).toContain("[x] ui");
    expect(lineOf(t.frame(), "Tags")).toContain("[ ] cli");
    expect(lineOf(t.frame(), "Tags")).toContain("[x] docs");
    await t.press(keys.ctrl("s"));
    expect(onSubmit.mock.calls[0]?.[0].tags).toEqual(["ui", "docs"]);
  });

  it("submits on enter after the last field", async () => {
    const { tui, onSubmit } = setup({ initialValues: { title: "x" } });
    const t = await tui;
    await t.press(...Array(FIELDS.length).fill(keys.tab));
    expect(t.frame()).toContain("ctrl+s save");
    await t.press(keys.enter);
    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it("submits on enter from a typed field with submitOnEnter", async () => {
    const { tui, onSubmit } = setup({ fields: TITLE_ONLY, submitOnEnter: true });
    const t = await tui;
    await t.type("Fix bug");
    await t.press(keys.enter);
    expect(onSubmit).toHaveBeenCalledWith({ title: "Fix bug" });
  });

  it("moves to the next field on enter from a field that is not typed, with submitOnEnter", async () => {
    const { tui, onSubmit } = setup({ initialValues: { title: "x" }, submitOnEnter: true });
    const t = await tui;
    await t.press(keys.tab, keys.tab, keys.tab);
    expect(t.frame()).toContain("› Blocked");
    await t.press(keys.enter);
    expect(t.frame()).toContain("› Stage");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("shows a required error, does not submit, and clears the error on an edit", async () => {
    const onInvalid = vi.fn();
    const { tui, onSubmit } = setup({ onInvalid });
    const t = await tui;
    await t.press(keys.ctrl("s"));
    expect(t.frame()).toContain("! required");
    expect(onSubmit).not.toHaveBeenCalled();
    expect(onInvalid).toHaveBeenCalledOnce();
    await t.type("a");
    expect(t.frame()).not.toContain("! required");
  });

  it("shows number and date errors", async () => {
    const { tui, onSubmit } = setup({ initialValues: { title: "x", points: "many", due: "tomorrow" } });
    const t = await tui;
    await t.press(keys.ctrl("s"));
    expect(t.frame()).toContain("! must be a number");
    expect(t.frame()).toContain("! must be a date (YYYY-MM-DD)");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("shows ValidationError issues under their fields and the other messages below the form", async () => {
    const onSubmit = vi.fn(() => {
      throw new ValidationError("Invalid story", {
        details: {
          issues: [
            { path: ["title"], message: "title is taken" },
            { path: ["owner"], message: "owner is unknown" },
          ],
        },
      });
    });
    const t = await renderTui(<Form fields={FIELDS} initialValues={{ title: "x" }} onSubmit={onSubmit} />);
    await t.press(keys.ctrl("s"));
    const lines = t.frame().split("\n");
    const title = lines.findIndex((l) => l.includes("Title"));
    expect(lines[title + 1]).toContain("! title is taken");
    expect(t.frame()).toContain("owner is unknown");
    expect(t.frame()).not.toContain("Invalid story");
    expect(t.toasts.list()).toEqual([]);
  });

  it("shows the message of a ValidationError without issues", async () => {
    const onSubmit = vi.fn(async () => {
      throw new ValidationError("Invalid story");
    });
    const t = await renderTui(<Form fields={FIELDS} initialValues={{ title: "x" }} onSubmit={onSubmit} />);
    await t.press(keys.ctrl("s"));
    expect(t.frame()).toContain("Invalid story");
  });

  it("shows other errors as toasts", async () => {
    const onSubmit = vi
      .fn()
      .mockRejectedValueOnce(new NotFoundError("No project", { hint: "run rowbly init" }))
      .mockRejectedValueOnce(new Error("boom"));
    const t = await renderTui(<Form fields={FIELDS} initialValues={{ title: "x" }} onSubmit={onSubmit} />);
    await t.press(keys.ctrl("s"), keys.ctrl("s"));
    expect(t.toasts.list().map((toast) => toast.message)).toEqual([
      "No project (run rowbly init)",
      "internal error: boom",
    ]);
  });

  it("fills a field from another when focus leaves it, until the user types in it", async () => {
    const fields: FormField[] = [
      { name: "name", label: "Name", kind: "text" },
      { name: "key", label: "Key", kind: "text", fillFrom: { field: "name", format: (s) => s.toUpperCase() } },
    ];
    const onSubmit = vi.fn();
    const t = await renderTui(<Form fields={fields} onSubmit={onSubmit} />);
    await t.type("web");
    await t.press(keys.tab);
    expect(lineOf(t.frame(), "Key")).toContain("WEB");
    // A filled value follows a new name.
    await t.press(keys.shiftTab);
    await t.type("app");
    await t.press(keys.tab);
    expect(lineOf(t.frame(), "Key")).toContain("WEBAPP");
    // A typed value stays.
    await t.type("X");
    await t.press(keys.shiftTab);
    await t.type("z");
    await t.press(keys.ctrl("s"));
    expect(onSubmit).toHaveBeenCalledWith({ name: "webappz", key: "WEBAPPX" });
  });

  it("fills from the focused field on submit", async () => {
    const fields: FormField[] = [
      { name: "name", label: "Name", kind: "text" },
      { name: "key", label: "Key", kind: "text", fillFrom: { field: "name", format: (s) => `${s}-key` } },
    ];
    const onSubmit = vi.fn();
    const t = await renderTui(<Form fields={fields} onSubmit={onSubmit} />);
    await t.type("web");
    await t.press(keys.ctrl("s"));
    expect(onSubmit).toHaveBeenCalledWith({ name: "web", key: "web-key" });
  });

  it("edits a multiline field, where enter starts a new line and ↓ from the last row leaves it", async () => {
    const fields: FormField[] = [
      { name: "body", label: "Body", kind: "multiline" },
      { name: "done", label: "Done", kind: "boolean" },
    ];
    const onSubmit = vi.fn();
    const t = await renderTui(<Form fields={fields} onSubmit={onSubmit} />);
    expect(t.frame()).toContain("enter new line · ctrl+f full screen");
    await t.type("a");
    await t.press(keys.enter);
    await t.type("b");
    expect(t.frame()).toContain("› Body");
    await t.press(keys.down);
    expect(t.frame()).toContain("› Done");
    await t.press(keys.ctrl("s"));
    expect(onSubmit).toHaveBeenCalledWith({ body: "a\nb", done: false });
  });

  it("moves the focus to a clicked field", async () => {
    const t = await setup().tui;
    await t.click("Points");
    expect(t.frame()).toContain("› Points");
    expect(t.frame()).toContain("type a number");
  });

  it("takes no keys while not active", async () => {
    const { tui, onSubmit } = setup({ isActive: false, initialValues: { title: "x" } });
    const t = await tui;
    await t.press(keys.tab, keys.ctrl("s"));
    await t.type("abc");
    expect(t.frame()).toContain("› Title");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("reads controlled values and reports every change through onChange", async () => {
    const onChange = vi.fn();
    const t = await renderTui(<Controlled onChange={onChange} />);
    expect(lineOf(t.frame(), "Title")).toContain("a");
    await t.type("b");
    expect(onChange).toHaveBeenLastCalledWith({ title: "ab", extra: 1 });
    expect(lineOf(t.frame(), "Title")).toContain("ab");
  });

  it("validates and submits when submitRequest goes up", async () => {
    const onSubmit = vi.fn();
    const onInvalid = vi.fn();
    const t = await renderTui(<Form fields={FIELDS} onSubmit={onSubmit} onInvalid={onInvalid} />);
    await t.rerender(<Form fields={FIELDS} onSubmit={onSubmit} onInvalid={onInvalid} submitRequest={1} />);
    expect(onInvalid).toHaveBeenCalledOnce();
    await t.type("x");
    await t.rerender(<Form fields={FIELDS} onSubmit={onSubmit} onInvalid={onInvalid} submitRequest={2} />);
    expect(onSubmit).toHaveBeenCalledOnce();
  });
});
