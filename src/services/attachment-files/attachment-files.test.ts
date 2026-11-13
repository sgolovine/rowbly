import { describe, expect, it } from "vitest";
import { prepareImages } from "./attachment-files.js";

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
