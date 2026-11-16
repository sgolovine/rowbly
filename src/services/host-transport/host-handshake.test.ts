import { describe, expect, it } from "vitest";
import { createFakeHostTransport } from "../test-project/fake-host-transport.js";
import { HostProtocolError, HostTimeoutError, HostVersionMismatchError } from "./host-errors.js";
import { checkHello, openHostChannel } from "./host-handshake.js";
import { HOST_PROTOCOL_VERSION, helloFrame, localVersions } from "./host-transport.js";

const COMMAND = ["rowbly", "host", "attach"];
const LOCAL = { protocol: 1, rowbly: "1.2.3" };

function noHandlers() {
  return { onFrame: () => {}, onClose: () => {} };
}

describe("host handshake", () => {
  it("uses protocol version 2 and the Rowbly version of package.json", () => {
    expect(HOST_PROTOCOL_VERSION).toBe(2);
    expect(localVersions().protocol).toBe(2);
    expect(localVersions().rowbly).toMatch(/^\d+\.\d+\.\d+/);
    expect(helloFrame(LOCAL)).toEqual({ type: "hello", protocol: 1, rowbly: "1.2.3" });
  });

  it("accepts equal versions", () => {
    expect(checkHello({ type: "hello", protocol: 1, rowbly: "1.2.3" }, LOCAL)).toMatchObject({ rowbly: "1.2.3" });
  });

  it("gives a version mismatch with all versions when the protocol is different", () => {
    const error = (() => {
      try {
        checkHello({ type: "hello", protocol: 2, rowbly: "1.2.3" }, LOCAL);
      } catch (caught) {
        return caught;
      }
    })();
    expect(error).toBeInstanceOf(HostVersionMismatchError);
    expect((error as HostVersionMismatchError).details).toEqual({
      localProtocol: 1,
      remoteProtocol: 2,
      localRowbly: "1.2.3",
      remoteRowbly: "1.2.3",
    });
  });

  it("gives a version mismatch with all versions when the Rowbly version is different", () => {
    expect(() => checkHello({ type: "hello", protocol: 1, rowbly: "1.2.4" }, LOCAL)).toThrow(
      expect.objectContaining({
        code: "HOST_VERSION_MISMATCH",
        details: { localProtocol: 1, remoteProtocol: 1, localRowbly: "1.2.3", remoteRowbly: "1.2.4" },
      }),
    );
  });

  it("gives a protocol error when the first frame is not a hello", () => {
    expect(() => checkHello({ type: "status" }, LOCAL)).toThrow(HostProtocolError);
  });

  it("opens a channel after an equal hello and gives the later frames", async () => {
    const frames: unknown[] = [];
    const transport = createFakeHostTransport({
      channel: (_command, remote) => {
        remote.send(helloFrame(LOCAL));
        remote.send({ type: "status" });
        return (frame) => remote.send({ echo: frame });
      },
    });
    const channel = await openHostChannel(
      transport,
      COMMAND,
      { onFrame: (frame) => frames.push(frame), onClose: () => {} },
      { local: LOCAL },
    );
    channel.send({ n: 1 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(frames).toEqual([{ type: "status" }, { echo: { n: 1 } }]);
  });

  it("rejects and closes the channel when the versions are different", async () => {
    const transport = createFakeHostTransport({
      channel: (_command, remote) => {
        remote.send(helloFrame({ protocol: 1, rowbly: "9.9.9" }));
        return undefined;
      },
    });
    await expect(openHostChannel(transport, COMMAND, noHandlers(), { local: LOCAL })).rejects.toBeInstanceOf(
      HostVersionMismatchError,
    );
    expect(transport.openChannels).toBe(0);
  });

  it("rejects when the channel closes before the hello", async () => {
    const transport = createFakeHostTransport({
      channel: (_command, remote) => {
        remote.close(1);
        return undefined;
      },
    });
    await expect(openHostChannel(transport, COMMAND, noHandlers(), { local: LOCAL })).rejects.toBeInstanceOf(
      HostProtocolError,
    );
  });

  it("rejects with a timeout when the hello does not come", async () => {
    const transport = createFakeHostTransport({ channel: () => undefined });
    await expect(
      openHostChannel(transport, COMMAND, noHandlers(), { local: LOCAL, helloTimeoutMs: 20 }),
    ).rejects.toBeInstanceOf(HostTimeoutError);
    expect(transport.openChannels).toBe(0);
  });

  it("rejects with the unreachable error when the host is disconnected", async () => {
    const transport = createFakeHostTransport();
    transport.disconnect();
    await expect(openHostChannel(transport, COMMAND, noHandlers(), { local: LOCAL })).rejects.toMatchObject({
      code: "HOST_UNREACHABLE",
    });
  });
});
