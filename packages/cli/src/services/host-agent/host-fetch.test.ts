import { readdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { useTempDir } from "../test-project/test-project.js";
import { hostAgentPaths } from "./host-agent-paths.js";
import {
  readFetchFailure,
  readFetchRequests,
  removeFetchRequest,
  writeFetchFailure,
  writeFetchRequest,
} from "./host-fetch.js";

const ID_A = "a00000000-0000-4000-8000-000000000001";
const ID_B = "a00000000-0000-4000-8000-000000000002";
const now = new Date("2026-01-02T03:04:05.000Z");

describe("host fetch requests", () => {
  const home = useTempDir();
  const paths = () => hostAgentPaths("p1", home.path);

  it("writes, lists and removes a request with private modes", async () => {
    await writeFetchRequest(paths(), { storyId: "ROW-2", id: ID_B, now });
    await writeFetchRequest(paths(), { storyId: "ROW-1", id: ID_A, now });

    expect(await readFetchRequests(paths())).toEqual([
      { version: 1, storyId: "ROW-1", id: ID_A, requestedAt: now.toISOString() },
      { version: 1, storyId: "ROW-2", id: ID_B, requestedAt: now.toISOString() },
    ]);
    expect((await stat(paths().fetch)).mode & 0o777).toBe(0o700);
    expect((await stat(join(paths().fetch, `${ID_A}.json`))).mode & 0o777).toBe(0o600);

    await removeFetchRequest(paths(), ID_A);
    expect((await readFetchRequests(paths())).map((request) => request.id)).toEqual([ID_B]);
  });

  it("writes a failure answer only for an open request, and a new request removes the old answer", async () => {
    expect(await writeFetchFailure(paths(), ID_A, "No file")).toBe(false);
    expect(await readFetchFailure(paths(), ID_A)).toBeUndefined();

    await writeFetchRequest(paths(), { storyId: "ROW-1", id: ID_A, now });
    expect(await writeFetchFailure(paths(), ID_A, "No file")).toBe(true);
    expect(await readFetchFailure(paths(), ID_A)).toBe("No file");
    expect(await readFetchRequests(paths())).toHaveLength(1);

    await writeFetchRequest(paths(), { storyId: "ROW-1", id: ID_A, now });
    expect(await readFetchFailure(paths(), ID_A)).toBeUndefined();

    await writeFetchFailure(paths(), ID_A, "No file");
    await removeFetchRequest(paths(), ID_A);
    expect(await readdir(paths().fetch)).toEqual([]);
  });

  it("skips bad files and refuses bad ids before a path is made", async () => {
    await writeFetchRequest(paths(), { storyId: "ROW-1", id: ID_A, now });
    await writeFile(join(paths().fetch, `${ID_B}.json`), "{bad");
    await writeFile(join(paths().fetch, "other.json"), "{}");
    expect((await readFetchRequests(paths())).map((request) => request.id)).toEqual([ID_A]);

    for (const id of ["../x", "", "ABC"]) {
      await expect(writeFetchRequest(paths(), { storyId: "ROW-1", id, now })).rejects.toMatchObject({
        code: "VALIDATION",
      });
    }
    await expect(writeFetchRequest(paths(), { storyId: "../x", id: ID_B, now })).rejects.toMatchObject({
      code: "VALIDATION",
    });
    expect((await readdir(paths().fetch)).toSorted()).toEqual([`${ID_A}.json`, `${ID_B}.json`, "other.json"]);
  });
});
