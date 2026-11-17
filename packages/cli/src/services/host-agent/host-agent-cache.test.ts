import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { MAX_ATTACHMENT_BYTES } from "../attachment-files/attachment-files.js";
import { useTempDir } from "../test-project/test-project.js";
import { hostCacheMissing, hostCachePut } from "./host-agent-cache.js";
import { readBoundedInput } from "./host-agent-input.js";
import { hostAgentPaths } from "./host-agent-paths.js";

const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
const ID = "a00000000-0000-4000-8000-000000000001";
const ID2 = "a00000000-0000-4000-8000-000000000002";

describe("host attachment cache", () => {
  const home = useTempDir();
  const paths = () => hostAgentPaths("p1", home.path);

  it("gives only the ids that are not in the cache, and a put removes the id from the list", async () => {
    expect(await hostCacheMissing(paths(), { ids: [ID, ID2] })).toEqual({ missing: [ID, ID2] });

    expect(await hostCachePut(paths(), ID, PNG)).toEqual({ id: ID, added: true });
    expect(await hostCachePut(paths(), ID, PNG)).toEqual({ id: ID, added: false });

    expect(await hostCacheMissing(paths(), { ids: [ID, ID2] })).toEqual({ missing: [ID2] });
  });

  it("accepts an attachment file of any type", async () => {
    expect(await hostCachePut(paths(), ID, Buffer.from("%PDF-1.7"))).toEqual({ id: ID, added: true });
    expect(await hostCacheMissing(paths(), { ids: [ID] })).toEqual({ missing: [] });
  });

  it("gives VALIDATION for a bad id and bytes larger than 10 MiB", async () => {
    const validation = expect.objectContaining({ code: "VALIDATION" });

    await expect(hostCacheMissing(paths(), { ids: ["../x"] })).rejects.toEqual(validation);
    await expect(hostCacheMissing(paths(), { ids: "x" })).rejects.toEqual(validation);
    await expect(hostCachePut(paths(), "../x", PNG)).rejects.toEqual(validation);

    const large = Buffer.concat([PNG, Buffer.alloc(MAX_ATTACHMENT_BYTES)]);
    await expect(hostCachePut(paths(), ID, large)).rejects.toEqual(validation);
    await expect(readBoundedInput(Readable.from([large]), MAX_ATTACHMENT_BYTES)).rejects.toEqual(validation);
    expect(await hostCacheMissing(paths(), { ids: [ID] })).toEqual({ missing: [ID] });
  });

  it("reads a bounded input in more than one chunk", async () => {
    const input = Readable.from([Buffer.from("ab"), Buffer.from("cd")]);
    expect((await readBoundedInput(input, 4)).toString()).toBe("abcd");
  });
});
