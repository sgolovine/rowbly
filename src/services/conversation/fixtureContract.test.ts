import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { loadPi } from "../piRuntime/piRuntime.js";
import { useTempDir } from "../testProject/testProject.js";

describe("conversation fixture SDK contract", () => {
  const dir = useTempDir();
  it("matches the current SDK branch semantics without opening a persisted session", async () => {
    const sdk = await loadPi();
    const records = sdk.parseSessionEntries(
      await readFile(new URL("./fixtures/branch.jsonl", import.meta.url), "utf8"),
    );
    const session = sdk.SessionManager.inMemory(dir.path, { id: "fixture" }, records);
    expect(session.getBranch().map((e) => e.id)).toEqual(["a", "b", "c", "d"]);
    expect(records[0]).toMatchObject({ type: "session", version: 3 });
  });
});
