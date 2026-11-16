import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { useTempDir } from "../test-project/test-project.js";
import { hostAgentPaths } from "./host-agent-paths.js";
import { readMainFrames, sendFetchRequests } from "./host-attach-fetch.js";
import { readFetchFailure, removeFetchRequest, writeFetchRequest } from "./host-fetch.js";

const ID = "a00000000-0000-4000-8000-000000000001";

describe("host attach fetch frames", () => {
  const home = useTempDir();
  const paths = () => hostAgentPaths("p1", home.path);

  it("sends a request one time, and again after a new request of the same id", async () => {
    const lines: string[] = [];
    const write = (line: string) => void lines.push(line);
    await writeFetchRequest(paths(), { storyId: "ROW-1", id: ID, now: new Date("2026-01-01T00:00:00.000Z") });

    const first = await sendFetchRequests(paths(), new Map(), write);
    const second = await sendFetchRequests(paths(), first, write);
    expect(lines).toEqual([`{"type":"attachment-request","storyId":"ROW-1","id":"${ID}"}\n`]);
    expect([...second.keys()]).toEqual([ID]);

    await removeFetchRequest(paths(), ID);
    const third = await sendFetchRequests(paths(), second, write);
    expect(third.size).toBe(0);
    await writeFetchRequest(paths(), { storyId: "ROW-1", id: ID, now: new Date("2026-01-01T00:00:01.000Z") });
    await sendFetchRequests(paths(), third, write);
    expect(lines).toHaveLength(2);
  });

  it("writes a failure answer from frames split across chunks, and ignores bad lines", async () => {
    await writeFetchRequest(paths(), { storyId: "ROW-1", id: ID, now: new Date() });
    const input = new PassThrough();
    readMainFrames(input, paths());

    input.write(`${"x".repeat(2 * 1024 * 1024)}\n`);
    input.write('{"type":"attachment-failed",');
    input.write(`"id":"${ID}","message":"Gone"}\n`);
    await vi.waitFor(async () => expect(await readFetchFailure(paths(), ID)).toBe("Gone"));
    input.end();
  });
});
