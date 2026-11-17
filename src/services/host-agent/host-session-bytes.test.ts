import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { useTempDir } from "../test-project/test-project.js";
import { hostAgentPaths } from "./host-agent-paths.js";
import { completeBytes, hostSessionBytes, isSessionFileOf, parseSessionBytesInput } from "./host-session-bytes.js";
import { MAX_SESSION_READ_BYTES } from "./host-session-lines.js";

describe("host session bytes", () => {
  const home = useTempDir();
  const paths = () => hostAgentPaths("p1", home.path);

  async function writeSession(content: Buffer | string, file = "sessions/t1/s.jsonl") {
    const path = join(paths().runtime, file);
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, content);
  }

  it("accepts only a session file of the Thread", () => {
    expect(isSessionFileOf("t1", "sessions/t1/s.jsonl")).toBe(true);
    expect(isSessionFileOf("t1", "sessions/t2/s.jsonl")).toBe(false);
    expect(isSessionFileOf("t1", "/sessions/t1/s.jsonl")).toBe(false);
    expect(isSessionFileOf("t1", "sessions/t1/../t2/s.jsonl")).toBe(false);
    expect(isSessionFileOf("t1", "sessions/t1/s.txt")).toBe(false);
  });

  it.each([
    [{ threadId: "t1", file: "/abs/sessions/t1/s.jsonl", offset: 0 }],
    [{ threadId: "t1", file: "sessions/t1/../../x.jsonl", offset: 0 }],
    [{ threadId: "t1", file: "sessions/t2/s.jsonl", offset: 0 }],
    [{ threadId: "t1", file: "threads/t1.jsonl", offset: 0 }],
    [{ threadId: "../t1", file: "sessions/../t1/s.jsonl", offset: 0 }],
    [{ threadId: "t1", file: "sessions/t1/s.jsonl", offset: -1 }],
    [{ threadId: "t1", file: "sessions/t1/s.jsonl", offset: 1.5 }],
    [null],
  ])("refuses the input %j with VALIDATION", async (input) => {
    expect(() => parseSessionBytesInput(input)).toThrow(expect.objectContaining({ code: "VALIDATION" }));
    await expect(hostSessionBytes(paths(), input)).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("gives the complete lines from the offset, and keeps a part line at the end", async () => {
    await writeSession('{"a":1}\n{"b":"é"}\n{"c":');

    const all = await hostSessionBytes(paths(), { threadId: "t1", file: "sessions/t1/s.jsonl", offset: 0 });
    expect(all.toString()).toBe('{"a":1}\n{"b":"é"}\n');

    const rest = await hostSessionBytes(paths(), { threadId: "t1", file: "sessions/t1/s.jsonl", offset: 8 });
    expect(rest.toString()).toBe('{"b":"é"}\n');

    const part = await hostSessionBytes(paths(), { threadId: "t1", file: "sessions/t1/s.jsonl", offset: all.length });
    expect(part.length).toBe(0);
  });

  it("gives no bytes at or after the end, and NOT_FOUND for a missing file", async () => {
    await writeSession("x\n");

    for (const offset of [2, 100]) {
      const bytes = await hostSessionBytes(paths(), { threadId: "t1", file: "sessions/t1/s.jsonl", offset });
      expect(bytes.length).toBe(0);
    }
    await expect(
      hostSessionBytes(paths(), { threadId: "t1", file: "sessions/t1/missing.jsonl", offset: 0 }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("gives no more than 4 MiB, and the full window of a long line that continues", async () => {
    const long = `${"x".repeat(MAX_SESSION_READ_BYTES + 10)}\n`;
    await writeSession(`a\n${long}b\n`);
    const input = { threadId: "t1", file: "sessions/t1/s.jsonl" };

    const first = await hostSessionBytes(paths(), { ...input, offset: 0 });
    expect(first.toString()).toBe("a\n");

    const window = await hostSessionBytes(paths(), { ...input, offset: 2 });
    expect(window.length).toBe(MAX_SESSION_READ_BYTES);

    const end = await hostSessionBytes(paths(), { ...input, offset: 2 + window.length });
    expect(end.toString()).toBe(`${"x".repeat(10)}\nb\n`);
  });

  it("cuts a window at its last newline", () => {
    expect(completeBytes(Buffer.from("a\nb"), true).toString()).toBe("a\n");
    expect(completeBytes(Buffer.from("a\nb"), false).toString()).toBe("a\n");
    expect(completeBytes(Buffer.from("ab"), true).length).toBe(0);
    expect(completeBytes(Buffer.from("ab"), false).toString()).toBe("ab");
  });
});
