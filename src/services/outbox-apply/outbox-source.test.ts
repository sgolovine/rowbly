import { describe, expect, it } from "vitest";
import type { RemoteCommand } from "../host-transport/host-transport.js";
import { createFakeHostTransport } from "../test-project/fake-host-transport.js";
import { transportOutboxSource } from "./outbox-source.js";

const ROWBLY = "/opt/rowbly/bin/rowbly";
const SHA = "a".repeat(64);

describe("transportOutboxSource", () => {
  it("runs the fixed host commands with the JSON input", async () => {
    const calls: [RemoteCommand, unknown][] = [];
    const transport = createFakeHostTransport({
      request: (command, input) => {
        calls.push([command, input]);
        return { exitCode: 0, value: command[2] === "outbox" ? { entries: [{ seq: 4 }] } : {}, stderr: "" };
      },
      bytes: (command, input) => {
        calls.push([command, input]);
        return { exitCode: 0, bytes: Buffer.from("png"), stderr: "" };
      },
    });
    const source = transportOutboxSource({ transport, rowbly: ROWBLY });

    expect(await source.entriesAfter(3)).toEqual([{ seq: 4 }]);
    expect(Buffer.from(await source.blob(SHA)).toString()).toBe("png");
    await source.acknowledge(4);

    expect(calls).toEqual([
      [[ROWBLY, "host", "outbox"], { afterSeq: 3 }],
      [[ROWBLY, "host", "blob", SHA], null],
      [[ROWBLY, "host", "outbox-ack"], { seq: 4 }],
    ]);
  });

  it("puts the project id at the end of each host command when the input has one", async () => {
    const commands: RemoteCommand[] = [];
    const transport = createFakeHostTransport({
      request: (command) => {
        commands.push(command);
        return { exitCode: 0, value: { entries: [] }, stderr: "" };
      },
      bytes: (command) => {
        commands.push(command);
        return { exitCode: 0, bytes: Buffer.from("png"), stderr: "" };
      },
    });
    const source = transportOutboxSource({ transport, rowbly: ROWBLY, projectId: "web-0123456789ab" });

    await source.entriesAfter(0);
    await source.blob(SHA);
    await source.acknowledge(1);

    expect(commands).toEqual([
      [ROWBLY, "host", "outbox", "web-0123456789ab"],
      [ROWBLY, "host", "blob", SHA, "web-0123456789ab"],
      [ROWBLY, "host", "outbox-ack", "web-0123456789ab"],
    ]);
  });

  it("gives a HOST_PROTOCOL error with the stderr text for a remote exit code other than 0", async () => {
    const transport = createFakeHostTransport({
      request: () => ({ exitCode: 1, value: undefined, stderr: "ROWBLY_OUTBOX is not set\n" }),
      bytes: () => ({ exitCode: 1, bytes: Buffer.alloc(0), stderr: "Outbox blob not found" }),
    });
    const source = transportOutboxSource({ transport, rowbly: ROWBLY });

    await expect(source.entriesAfter(0)).rejects.toMatchObject({
      code: "HOST_PROTOCOL",
      message: expect.stringContaining("ROWBLY_OUTBOX is not set"),
      details: { exitCode: 1, stderr: "ROWBLY_OUTBOX is not set" },
    });
    await expect(source.acknowledge(1)).rejects.toMatchObject({ code: "HOST_PROTOCOL" });
    await expect(source.blob(SHA)).rejects.toMatchObject({
      code: "HOST_PROTOCOL",
      message: expect.stringContaining("Outbox blob not found"),
    });
  });

  it("gives a HOST_PROTOCOL error for an answer without a list of entries", async () => {
    const transport = createFakeHostTransport({ request: () => ({ exitCode: 0, value: { items: [] }, stderr: "" }) });

    await expect(transportOutboxSource({ transport, rowbly: ROWBLY }).entriesAfter(0)).rejects.toMatchObject({
      code: "HOST_PROTOCOL",
    });
  });

  it("gives the unreachable error of the transport", async () => {
    const transport = createFakeHostTransport();
    transport.disconnect();

    await expect(transportOutboxSource({ transport, rowbly: ROWBLY }).entriesAfter(0)).rejects.toMatchObject({
      code: "HOST_UNREACHABLE",
    });
  });
});
