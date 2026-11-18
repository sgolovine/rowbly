import { stat, writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { newOwner } from "../factory-ownership/ownership-lock.js";
import { pathExists } from "../files/files.js";
import { useTempDir } from "../test-project/test-project.js";
import { hostAgentPaths } from "./host-agent-paths.js";
import { channelLive, removeChannelMark, writeChannelMark } from "./host-channel-mark.js";

describe("host channel mark", () => {
  const home = useTempDir();
  const paths = () => hostAgentPaths("p1", home.path);

  it("is live only while the mark exists and its process is not dead", async () => {
    expect(await channelLive(paths())).toBe(false);

    const owner = await newOwner();
    await writeChannelMark(paths(), owner);
    expect((await stat(paths().channel)).mode & 0o777).toBe(0o600);
    expect(await channelLive(paths(), async () => "alive")).toBe(true);
    expect(await channelLive(paths(), async () => "uncertain")).toBe(true);
    expect(await channelLive(paths(), async () => "dead")).toBe(false);
    expect(await channelLive(paths())).toBe(true);

    await removeChannelMark(paths(), owner.token);
    expect(await pathExists(paths().channel)).toBe(false);
    expect(await channelLive(paths(), async () => "alive")).toBe(false);
  });

  it("keeps the mark of a later channel, and treats a bad mark as not live", async () => {
    const first = await newOwner();
    const second = await newOwner();
    await writeChannelMark(paths(), first);
    await writeChannelMark(paths(), second);
    await removeChannelMark(paths(), first.token);
    expect(await pathExists(paths().channel)).toBe(true);

    await writeFile(paths().channel, "{bad");
    expect(await channelLive(paths(), async () => "alive")).toBe(false);
  });
});
