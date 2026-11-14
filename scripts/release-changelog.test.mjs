import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { releaseChangelog } from "./release-changelog.mjs";

const CHANGELOG = [
  "# Changelog",
  "",
  "### Pre Release",
  "",
  "- Added: a thing (ROW-42)",
  "",
  "### 0.17.0",
  "",
  "- Fixed: a bug (ROW-30)",
  "",
].join("\n");

describe("releaseChangelog", () => {
  it("renames Pre Release to the version and adds an empty Pre Release above it", () => {
    const expected = [
      "# Changelog",
      "",
      "### Pre Release",
      "",
      "### 0.18.0",
      "",
      "- Added: a thing (ROW-42)",
      "",
      "### 0.17.0",
      "",
      "- Fixed: a bug (ROW-30)",
      "",
    ].join("\n");

    assert.equal(releaseChangelog(CHANGELOG, "0.18.0"), expected);
  });

  it("releases an empty Pre Release section", () => {
    const text = "# Changelog\n\n### Pre Release\n";

    assert.equal(releaseChangelog(text, "1.0.0"), "# Changelog\n\n### Pre Release\n\n### 1.0.0\n");
  });

  it("rejects a changelog with no Pre Release heading or with two", () => {
    assert.throws(() => releaseChangelog("# Changelog\n\n### 0.17.0\n", "0.18.0"), /exactly one .* It has 0/);
    assert.throws(() => releaseChangelog("### Pre Release\n\n### Pre Release\n", "0.18.0"), /It has 2/);
  });

  it("rejects a version that is already in the changelog", () => {
    assert.throws(() => releaseChangelog(CHANGELOG, "0.17.0"), /already has/);
  });

  it("rejects a value that is not a semantic version", () => {
    assert.throws(() => releaseChangelog(CHANGELOG, "v0.18.0"), /not a semantic version/);
    assert.throws(() => releaseChangelog(CHANGELOG, ""), /not a semantic version/);
  });
});
