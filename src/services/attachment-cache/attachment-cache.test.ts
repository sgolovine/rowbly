import { readdir, readFile, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MAX_ATTACHMENT_BYTES } from "../attachment-files/attachment-files.js";
import { useTempDir } from "../test-project/test-project.js";
import {
  hasCachedAttachment,
  missingCachedAttachments,
  putCachedAttachment,
  readCachedAttachment,
} from "./attachment-cache.js";

const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
const OTHER = Buffer.from("89504e470d0a1a0a00000000", "hex");
const ID = "a00000000-0000-4000-8000-000000000001";
const ID2 = "a00000000-0000-4000-8000-000000000002";

describe("attachment cache", () => {
  const temp = useTempDir();
  const cache = () => join(temp.path, "cache");

  it("puts a PNG by id and reads it", async () => {
    expect(await putCachedAttachment({ dir: cache(), id: ID, bytes: PNG })).toBe(true);

    expect(await readCachedAttachment({ dir: cache(), id: ID })).toEqual(PNG);
    expect(await readdir(cache())).toEqual([`${ID}.png`]);
  });

  it("keeps the first file when the id is there", async () => {
    await putCachedAttachment({ dir: cache(), id: ID, bytes: PNG });

    expect(await putCachedAttachment({ dir: cache(), id: ID, bytes: OTHER })).toBe(false);

    expect(await readFile(join(cache(), `${ID}.png`))).toEqual(PNG);
    expect(await readdir(cache())).toEqual([`${ID}.png`]);
  });

  it("tells if an id is there", async () => {
    await putCachedAttachment({ dir: cache(), id: ID, bytes: PNG });

    expect(await hasCachedAttachment({ dir: cache(), id: ID })).toBe(true);
    expect(await hasCachedAttachment({ dir: cache(), id: ID2 })).toBe(false);
  });

  it("gives the ids of a list that are not there, in order", async () => {
    await putCachedAttachment({ dir: cache(), id: ID, bytes: PNG });

    expect(await missingCachedAttachments({ dir: cache(), ids: [ID2, ID] })).toEqual([ID2]);
    expect(await missingCachedAttachments({ dir: join(temp.path, "none"), ids: [ID] })).toEqual([ID]);
    expect(await missingCachedAttachments({ dir: cache(), ids: [] })).toEqual([]);
  });

  it("gives NOT_FOUND for a read of a missing id", async () => {
    await expect(readCachedAttachment({ dir: cache(), id: ID })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("refuses an invalid id in each function", async () => {
    for (const id of ["../x", "a1", `${ID}/x`]) {
      await expect(putCachedAttachment({ dir: cache(), id, bytes: PNG })).rejects.toMatchObject({
        code: "VALIDATION",
      });
      await expect(readCachedAttachment({ dir: cache(), id })).rejects.toMatchObject({ code: "VALIDATION" });
      await expect(hasCachedAttachment({ dir: cache(), id })).rejects.toMatchObject({ code: "VALIDATION" });
      await expect(missingCachedAttachments({ dir: cache(), ids: [ID, id] })).rejects.toMatchObject({
        code: "VALIDATION",
      });
    }
  });

  it("refuses bytes that are larger than 10 MiB, and writes no file", async () => {
    const large = Buffer.alloc(MAX_ATTACHMENT_BYTES + 1);
    PNG.copy(large);

    await expect(putCachedAttachment({ dir: cache(), id: ID, bytes: large })).rejects.toMatchObject({
      code: "VALIDATION",
    });

    expect(await hasCachedAttachment({ dir: cache(), id: ID })).toBe(false);
  });

  it("keeps the bytes of a file that is not a PNG, in the same `<id>.png` name", async () => {
    const pdf = Buffer.from("%PDF-1.7\n");

    expect(await putCachedAttachment({ dir: cache(), id: ID, bytes: pdf })).toBe(true);
    expect(await readCachedAttachment({ dir: cache(), id: ID })).toEqual(pdf);
    expect(await readdir(cache())).toEqual([`${ID}.png`]);
  });

  it("refuses a symlink in place of a cached PNG", async () => {
    const target = join(temp.path, "target.png");
    await writeFile(target, PNG);
    await putCachedAttachment({ dir: cache(), id: ID2, bytes: PNG });
    await symlink(target, join(cache(), `${ID}.png`));

    await expect(readCachedAttachment({ dir: cache(), id: ID })).rejects.toMatchObject({ code: "VALIDATION" });
  });
});
