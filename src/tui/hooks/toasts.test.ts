import { describe, expect, it, vi } from "vitest";
import { ValidationError } from "../../services/errors/errors.js";
import { createToastStore, showToast } from "./toasts.js";

describe("createToastStore", () => {
  it("keeps the same list until the toasts change", () => {
    const toasts = createToastStore();
    const first = toasts.list();

    expect(toasts.list()).toBe(first);
    toasts.push("info", "Saved");
    expect(toasts.list()).not.toBe(first);
    expect(toasts.list()).toBe(toasts.list());
  });

  it("shows at most three toasts, and keeps the pending ones", () => {
    const toasts = createToastStore();
    const id = toasts.pending("Reading…");

    for (const message of ["a", "b", "c"]) {
      toasts.push("info", message);
    }

    expect(toasts.list().map((toast) => toast.message)).toEqual(["Reading…", "b", "c"]);
    toasts.update(id, "Still reading…");
    expect(toasts.list()[0]).toMatchObject({ id, message: "Still reading…", pending: true });
    toasts.dismiss(id);
    expect(toasts.list().map((toast) => toast.message)).toEqual(["b", "c"]);
  });

  it("gives each toast a new id", () => {
    const toasts = createToastStore();

    toasts.push("info", "a");
    const id = toasts.pending("b");
    toasts.push("info", "c");

    expect(toasts.list().map((toast) => toast.id)).toEqual([1, id, 3]);
    expect(id).toBe(2);
  });

  it("shows the hint of a Rowbly error, and other errors as internal errors", () => {
    const toasts = createToastStore();

    toasts.error(new ValidationError("Bad title", { hint: "use a name" }));
    toasts.error(new Error("boom"));
    toasts.error("text");

    expect(toasts.list().map((toast) => [toast.kind, toast.message])).toEqual([
      ["error", "Bad title (use a name)"],
      ["error", "internal error: boom"],
      ["error", "internal error: text"],
    ]);
  });

  it("tells each listener about a change until it unsubscribes", () => {
    const toasts = createToastStore();
    const listener = vi.fn();
    const unsubscribe = toasts.subscribe(listener);

    showToast(toasts, "warning", "a");
    unsubscribe();
    toasts.push("info", "b");

    expect(listener).toHaveBeenCalledTimes(1);
    expect(toasts.list().at(0)).toMatchObject({ kind: "warning", message: "a" });
  });
});
