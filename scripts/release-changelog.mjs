// Renames the `### Pre Release` section of CHANGELOG.md to the new version and adds an empty
// `### Pre Release` section above it. The release workflow runs this before the version commit.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PRE_RELEASE = "### Pre Release";

/**
 * Returns the changelog text with the `### Pre Release` heading renamed to `### <version>` and a
 * new empty `### Pre Release` section above it.
 * @param {string} text
 * @param {string} version
 * @returns {string}
 */
export function releaseChangelog(text, version) {
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`"${version}" is not a semantic version.`);
  }

  const lines = text.split("\n");
  const matches = lines.flatMap((line, index) => (line.trimEnd() === PRE_RELEASE ? [index] : []));
  if (matches.length !== 1) {
    throw new Error(`CHANGELOG.md must have exactly one "${PRE_RELEASE}" heading. It has ${matches.length}.`);
  }
  if (lines.some((line) => line.trimEnd() === `### ${version}`)) {
    throw new Error(`CHANGELOG.md already has a "### ${version}" section.`);
  }

  const index = matches[0];
  return [...lines.slice(0, index), PRE_RELEASE, "", `### ${version}`, ...lines.slice(index + 1)].join("\n");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [version, path = "CHANGELOG.md"] = process.argv.slice(2);
  try {
    writeFileSync(path, releaseChangelog(readFileSync(path, "utf8"), version ?? ""));
  } catch (error) {
    console.error(`::error::${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
