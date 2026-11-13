import { describe, expect, it } from "vitest";
import { SessionScanner } from "./session-scanner.js";
import { MAX_ENTRY_BYTES } from "./session-types.js";

const header = JSON.stringify({ type: "session", version: 3, id: "s" });
const entry = (id: string, parentId: string | null, extra: object = {}) =>
  JSON.stringify({ type: "message", id, parentId, ...extra });

function scanText(scanner: SessionScanner, text: string, chunk = text.length): void {
  const bytes = Buffer.from(text);

  for (let start = 0; start < bytes.length; start += chunk) {
    const piece = bytes.subarray(start, start + chunk);
    scanner.scan(Buffer.from(piece), piece.length);
  }
}

describe("SessionScanner", () => {
  it("indexes complete lines across chunks and keeps a partial line pending", () => {
    const scanner = new SessionScanner();
    const text = `${header}\n${entry("a", null)}\n${entry("b", "a")}\n${entry("c", "b")}`;

    scanText(scanner, text, 7);

    const view = scanner.view();
    expect(view.status).toBe("ok");
    expect([...view.byId.keys()]).toEqual(["a", "b"]);
    expect(view.leaf).toBe("b");
    expect(view.byId.get("b")).toMatchObject({ parentId: "a", offset: header.length + entry("a", null).length + 2 });
    expect(scanner.offset).toBe(Buffer.byteLength(text));
    expect(scanner.diagnostics().pendingBytes).toBe(entry("c", "b").length);

    scanText(scanner, "\n");
    expect(scanner.view().leaf).toBe("c");
  });

  it("counts invalid and duplicate lines, and stops after an unsupported header", () => {
    const valid = new SessionScanner();
    scanText(valid, `${header}\nnot json\n${entry("a", null)}\n${entry("a", null)}\n${entry("", null)}\n`);
    expect(valid.view()).toMatchObject({ status: "ok", invalidLines: 3 });
    expect(valid.view().byId.size).toBe(1);

    const unsupported = new SessionScanner();
    scanText(unsupported, `${JSON.stringify({ type: "session", version: 2 })}\n${entry("a", null)}\n`);
    expect(unsupported.view()).toMatchObject({ status: "unsupported", invalidLines: 0 });
    expect(unsupported.view().byId.size).toBe(0);
  });

  it("indexes an oversized line from its top-level fields without retaining its bytes", () => {
    const scanner = new SessionScanner();
    const big = entry("big", null, { message: { content: "x".repeat(MAX_ENTRY_BYTES), nested: { id: "inner" } } });

    scanText(scanner, `${header}\n${big}\n`, 64 * 1024);

    expect(scanner.view().byId.get("big")).toMatchObject({ id: "big", parentId: null, length: Buffer.byteLength(big) });
    expect(scanner.diagnostics()).toMatchObject({ pendingBytes: 0, retainedBytes: 0 });
  });
});
