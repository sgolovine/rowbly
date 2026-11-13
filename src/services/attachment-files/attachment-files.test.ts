import { mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { useTestProject } from "../test-project/test-project.js";
import { moveAttachmentDirs, prepareImages } from "./attachment-files.js";

describe("attachment draft input", () => {
  it("copies bytes and keeps only the basename", () => {
    const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    const result = prepareImages([{ name: "folder/image.png", bytes }]);
    bytes[0] = 0;
    expect(result[0]?.name).toBe("image.png");
    expect(result[0]?.bytes[0]).toBe(137);
    expect(prepareImages([{ name: "C:\\images\\image.png", bytes: result[0]?.bytes as Uint8Array }])[0]?.name).toBe(
      "image.png",
    );
  });
});

describe("attachment folder moves", () => {
  const project = useTestProject();
  it("skips an absent folder and moves the completed folders back when a later move fails", async () => {
    const root = join(project.paths.dir, "attachments");
    await mkdir(join(root, "ROW-1"), { recursive: true });
    await mkdir(join(root, "ROW-2"));
    await mkdir(join(root, "ROW-4"));
    await mkdir(join(root, "NEW-4"));
    await expect(
      moveAttachmentDirs(project.paths, [
        { from: "ROW-1", to: "NEW-1" },
        { from: "ROW-3", to: "NEW-3" },
        { from: "ROW-2", to: "NEW-2" },
        { from: "ROW-4", to: "NEW-4" },
      ]),
    ).rejects.toThrow("Attachment directory already exists: NEW-4");
    expect((await readdir(root)).toSorted()).toEqual(["NEW-4", "ROW-1", "ROW-2", "ROW-4"]);
  });
});
