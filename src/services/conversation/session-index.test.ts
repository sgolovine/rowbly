import { appendFile, copyFile, readFile, rename, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { useTempDir } from "../test-project/test-project.js";
import { MAX_ENTRY_BYTES, SessionIndex } from "./session-index.js";

const fixture = new URL("./fixtures/branch.jsonl", import.meta.url);
const header = { type: "session", version: 3, id: "fixture", timestamp: "2026-11-12T00:00:00.000Z", cwd: "/tmp" };
const entry = (id: string, parentId: string | null, text = id) => ({
  type: "message",
  id,
  parentId,
  timestamp: header.timestamp,
  message: { role: "user", content: text, timestamp: 1794441600000 },
});
const lines = (...values: unknown[]) => `${values.map((v) => JSON.stringify(v)).join("\n")}\n`;
describe("SessionIndex", () => {
  const dir = useTempDir();
  it("excludes sibling branches and preserves original history through compaction and edits", async () => {
    const file = join(dir.path, "history.jsonl");
    await copyFile(fixture, file);
    const before = await readFile(file),
      info = await stat(file);
    const index = new SessionIndex(file);
    const latest = await index.page({ limit: 2 });
    expect(latest.entries.map((e) => e.id)).toEqual(["c", "d"]);
    const older = await index.page({ before: latest.nextBefore });
    expect(older.entries.map((e) => e.id)).toEqual(["a", "b"]);
    expect(older.entries[0].text).toContain("π🦆");
    expect(older.nextBefore).toBeNull();
    expect(await readFile(file)).toEqual(before);
    expect((await stat(file)).mtimeMs).toBe(info.mtimeMs);
    index.close();
    expect(index.diagnostics()).toMatchObject({ entries: 0, retainedBytes: 0, closed: true });
    await expect(index.page()).rejects.toThrow("closed");
  });
  it("waits for a partial UTF8 line and follows finalized appends", async () => {
    const file = join(dir.path, "partial.jsonl");
    const bytes = Buffer.from(lines(entry("a", null, "π🦆")));
    const cut = bytes.indexOf(Buffer.from("🦆")) + 2;
    await writeFile(file, lines(header));
    await appendFile(file, bytes.subarray(0, cut));
    const index = new SessionIndex(file);
    expect((await index.page()).entries).toHaveLength(0);
    await appendFile(file, bytes.subarray(cut));
    expect((await index.page()).entries[0].text).toBe("π🦆");
    await appendFile(file, lines(entry("b", "a")));
    expect((await index.page()).entries.map((e) => e.id)).toEqual(["a", "b"]);
  });
  it("rebuilds after truncate, replace, and same-size rewrite", async () => {
    const file = join(dir.path, "change.jsonl");
    await copyFile(fixture, file);
    const index = new SessionIndex(file);
    await index.refresh();
    await writeFile(file, lines(header, entry("x", null)));
    expect((await index.page()).entries.map((e) => e.id)).toEqual(["x"]);
    await writeFile(file, lines(header, entry("y", null)));
    expect((await index.page()).entries.map((e) => e.id)).toEqual(["y"]);
    const replacement = join(dir.path, "new");
    await writeFile(replacement, lines(header, entry("z", null)));
    await rename(replacement, file);
    expect((await index.page()).entries.map((e) => e.id)).toEqual(["z"]);
  });
  it("bounds a 21 MiB record with arbitrary key order and retains its parent link", async () => {
    const file = join(dir.path, "large.jsonl");
    await writeFile(file, lines(header, entry("a", null)));
    // Payload comes before index fields. A prefix match cannot find this branch link.
    await appendFile(
      file,
      `${JSON.stringify({ message: { role: "assistant", content: [{ type: "image", data: "x".repeat(21 * 1024 * 1024), mimeType: "image/png" }] }, parentId: "a", type: "message", id: "large", timestamp: header.timestamp })}\n`,
    );
    await appendFile(file, lines(entry("b", "large")));
    const index = new SessionIndex(file);
    const tail = await index.page();
    expect(tail.entries.map((e) => e.id)).toEqual(["b"]);
    const large = await index.page({ before: tail.nextBefore });
    expect(large.entries[0]).toMatchObject({ id: "large", oversized: true });
    const older = await index.page({ before: large.nextBefore });
    expect(older.entries[0].id).toBe("a");
    expect(index.diagnostics().retainedBytes).toBeLessThanOrEqual(MAX_ENTRY_BYTES);
    expect(large.bytes).toBeLessThanOrEqual(512 * 1024);
  });
  it("bounds partial oversized lines and rejects unsupported formats without migration", async () => {
    const file = join(dir.path, "unknown.jsonl");
    await writeFile(file, lines({ ...header, version: 2 }, entry("a", null)));
    const index = new SessionIndex(file);
    expect((await index.page()).status).toBe("unsupported");
    await writeFile(file, lines(header));
    await appendFile(file, `{"message":"${"x".repeat(2 * MAX_ENTRY_BYTES)}`);
    await index.refresh();
    expect(index.diagnostics().retainedBytes).toBe(0);
    index.close();
    expect(index.diagnostics().pendingBytes).toBe(0);
  });
  it("shows bounded tools and images without opaque signatures", async () => {
    const file = join(dir.path, "tools.jsonl");
    await writeFile(
      file,
      lines(header, {
        ...entry("a", null),
        message: {
          role: "assistant",
          content: [
            { type: "text", text: "Answer", textSignature: "secret-signature" },
            { type: "toolCall", name: "read", arguments: { path: "test" } },
            { type: "image", mimeType: "image/png", data: "base64-payload" },
          ],
        },
      }),
    );
    const page = await new SessionIndex(file).page();
    expect(page.entries[0].text).toContain("[tool read]");
    expect(page.entries[0].text).toContain("[image: image/png]");
    expect(JSON.stringify(page)).not.toContain("secret-signature");
    expect(JSON.stringify(page)).not.toContain("base64-payload");
  });
  it("pages forward from a cursor on the active branch only", async () => {
    const file = join(dir.path, "forward.jsonl");
    await writeFile(
      file,
      lines(
        header,
        entry("a", null),
        entry("b", "a"),
        entry("side", "b"),
        entry("c", "b"),
        entry("d", "c"),
        entry("e", "d"),
      ),
    );
    const index = new SessionIndex(file);
    const first = await index.page({ after: "a", limit: 2 });
    expect(first.entries.map((e) => e.id)).toEqual(["b", "c"]);
    expect(first.nextAfter).toBe("c");
    expect(first.nextBefore).toBe("b");
    const next = await index.page({ after: first.nextAfter, limit: 2 });
    expect(next.entries.map((e) => e.id)).toEqual(["d", "e"]);
    expect(next.nextAfter).toBeNull();
    expect((await index.page({ after: "e" })).entries).toEqual([]);
    await expect(index.page({ after: "side" })).rejects.toThrow("no longer available");
    await expect(index.page({ after: "a", before: "e" })).rejects.toThrow("one conversation cursor");
    const older = await index.page({ before: "c", limit: 1 });
    expect(older.entries.map((e) => e.id)).toEqual(["b"]);
    expect(older.nextBefore).toBe("b");
  });
});
