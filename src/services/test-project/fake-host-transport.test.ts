import { describe, expect, it } from "vitest";
import { ValidationError } from "../errors/errors.js";
import { HostUnreachableError } from "../host-transport/host-errors.js";
import type { ChannelEnd } from "../host-transport/host-transport.js";
import { createFakeHostTransport } from "./fake-host-transport.js";

const COMMAND = ["rowbly", "host", "attach"];

describe("fake host transport", () => {
  it("answers request and bytes calls with copies of the data", async () => {
    const transport = createFakeHostTransport({
      request: (command, input) => ({ exitCode: 0, value: { command, input }, stderr: "" }),
      bytes: () => ({ exitCode: 0, bytes: Buffer.from([1, 2, 3]), stderr: "" }),
    });
    await expect(transport.request(COMMAND, { a: 1 })).resolves.toEqual({
      exitCode: 0,
      value: { command: COMMAND, input: { a: 1 } },
      stderr: "",
    });
    expect([...(await transport.bytes(COMMAND, {})).bytes]).toEqual([1, 2, 3]);
  });

  it("records the exact bytes of each upload and gives the result of the handler", async () => {
    const data = Buffer.from([0, 1, 2, 255, 10]);
    const transport = createFakeHostTransport({ upload: () => ({ exitCode: 2, stderr: "full" }) });
    const result = await transport.upload(["dd", "of=a.tgz"], data);
    data[0] = 9;
    expect(result).toEqual({ exitCode: 2, stderr: "full" });
    expect(transport.uploads).toHaveLength(1);
    expect(transport.uploads[0]?.command).toEqual(["dd", "of=a.tgz"]);
    expect([...(transport.uploads[0]?.data ?? [])]).toEqual([0, 1, 2, 255, 10]);
    await expect(createFakeHostTransport().upload(["dd"], data)).resolves.toEqual({ exitCode: 0, stderr: "" });
  });

  it("validates the remote command as the SSH transport does", async () => {
    await expect(createFakeHostTransport().request(["rowbly; id"], {})).rejects.toBeInstanceOf(ValidationError);
  });

  it("closes the open channels and fails new calls after disconnect, and works again after reconnect", async () => {
    const transport = createFakeHostTransport({ channel: () => undefined });
    const ends: ChannelEnd[] = [];
    await transport.channel(COMMAND, { onFrame: () => {}, onClose: (end) => ends.push(end) });
    expect(transport.openChannels).toBe(1);

    transport.disconnect();

    expect(transport.connected).toBe(false);
    expect(transport.openChannels).toBe(0);
    expect(ends).toHaveLength(1);
    expect(ends[0]?.error).toBeInstanceOf(HostUnreachableError);
    await expect(transport.request(COMMAND, {})).rejects.toBeInstanceOf(HostUnreachableError);
    await expect(transport.bytes(COMMAND, {})).rejects.toBeInstanceOf(HostUnreachableError);
    await expect(transport.channel(COMMAND, { onFrame: () => {}, onClose: () => {} })).rejects.toMatchObject({
      code: "HOST_UNREACHABLE",
    });

    transport.reconnect();

    expect(transport.connected).toBe(true);
    await expect(transport.request(COMMAND, {})).resolves.toMatchObject({ exitCode: 0 });
    await transport.channel(COMMAND, { onFrame: () => {}, onClose: () => {} });
    expect(transport.openChannels).toBe(1);
  });

  it("records the frames that the main machine sends", async () => {
    const remotes: { received: readonly unknown[] }[] = [];
    const transport = createFakeHostTransport({
      channel: (_command, remote) => {
        remotes.push(remote);
        return undefined;
      },
    });
    const channel = await transport.channel(COMMAND, { onFrame: () => {}, onClose: () => {} });
    channel.send({ a: 1 });
    channel.close();
    channel.send({ b: 2 });
    expect(remotes[0]?.received).toEqual([{ a: 1 }]);
    expect(transport.openChannels).toBe(0);
  });
});
