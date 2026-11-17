import { describe, expect, it } from "vitest";
import { attachmentFileName, attachmentType, isAttachmentFileName, isMimeType } from "./attachment-type.js";

const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1]);
const TEXT = new TextEncoder().encode("hello");
const ID = "a00000000-0000-4000-8000-000000000001";

describe("attachmentType", () => {
  it("gives image/png for PNG bytes, also with a different name", () => {
    expect(attachmentType("shot.png", PNG)).toBe("image/png");
    expect(attachmentType("shot", PNG)).toBe("image/png");
    expect(attachmentType("shot.txt", PNG)).toBe("image/png");
  });

  it("gives the type of a known extension, without regard to case", () => {
    expect(attachmentType("notes.txt", TEXT)).toBe("text/plain");
    expect(attachmentType("build.LOG", TEXT)).toBe("text/plain");
    expect(attachmentType("report.pdf", TEXT)).toBe("application/pdf");
    expect(attachmentType("photo.JPG", TEXT)).toBe("image/jpeg");
    expect(attachmentType("photo.jpeg", TEXT)).toBe("image/jpeg");
    expect(attachmentType("archive.tar.gz", TEXT)).toBe("application/gzip");
    expect(attachmentType("data.json", TEXT)).toBe("application/json");
  });

  it("gives application/octet-stream for an unknown extension, no extension or non-PNG bytes named .png", () => {
    expect(attachmentType("data.bin", TEXT)).toBe("application/octet-stream");
    expect(attachmentType("Makefile", TEXT)).toBe("application/octet-stream");
    expect(attachmentType(".bashrc", TEXT)).toBe("application/octet-stream");
    expect(attachmentType("fake.png", TEXT)).toBe("application/octet-stream");
    expect(attachmentType("empty.bin", new Uint8Array())).toBe("application/octet-stream");
  });
});

describe("isMimeType", () => {
  it("accepts a lower-case MIME type only", () => {
    expect(isMimeType("image/svg+xml")).toBe(true);
    expect(isMimeType("application/vnd.ms-excel")).toBe(true);
    expect(isMimeType("Text/Plain")).toBe(false);
    expect(isMimeType("text")).toBe(false);
    expect(isMimeType("text/plain; charset=utf-8")).toBe(false);
    expect(isMimeType(undefined)).toBe(false);
  });
});

describe("attachmentFileName", () => {
  it("keeps <id>.png for a PNG record", () => {
    expect(attachmentFileName({ id: ID, name: "shot.png", type: "image/png" })).toBe(`${ID}.png`);
    expect(attachmentFileName({ id: ID, name: "shot", type: "image/png" })).toBe(`${ID}.png`);
  });

  it("keeps the safe lower-case extension of the name for a different type", () => {
    expect(attachmentFileName({ id: ID, name: "report.pdf", type: "application/pdf" })).toBe(`${ID}.pdf`);
    expect(attachmentFileName({ id: ID, name: "notes.TXT", type: "text/plain" })).toBe(`${ID}.txt`);
    expect(attachmentFileName({ id: ID, name: "fake.png", type: "application/octet-stream" })).toBe(`${ID}.png`);
  });

  it("gives <id> with no extension when the name has no safe extension", () => {
    const type = "application/octet-stream";

    expect(attachmentFileName({ id: ID, name: "Makefile", type })).toBe(ID);
    expect(attachmentFileName({ id: ID, name: ".bashrc", type })).toBe(ID);
    expect(attachmentFileName({ id: ID, name: "file.", type })).toBe(ID);
    expect(attachmentFileName({ id: ID, name: "file.tar-gz", type })).toBe(ID);
    expect(attachmentFileName({ id: ID, name: `file.${"x".repeat(17)}`, type })).toBe(ID);
    expect(attachmentFileName({ id: ID, name: "file.é", type })).toBe(ID);
  });
});

describe("isAttachmentFileName", () => {
  it("accepts the id alone or with one safe extension", () => {
    for (const file of [ID, `${ID}.png`, `${ID}.pdf`]) expect(isAttachmentFileName(ID, file)).toBe(true);
  });

  it("refuses a name of a different id, a path or an unsafe extension", () => {
    for (const file of [undefined, "", "x.png", `${ID}/a`, `${ID}..png`, `${ID}.PNG`, `../${ID}.png`, `${ID}.a/b`]) {
      expect(isAttachmentFileName(ID, file)).toBe(false);
    }
  });
});
