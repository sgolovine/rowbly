import { describe, expect, it } from "vitest";
import { RowblyError } from "../errors/errors.js";
import {
  classifySshExit,
  HostAuthFailedError,
  HostProtocolError,
  HostTimeoutError,
  HostUnreachableError,
  HostVersionMismatchError,
} from "./host-errors.js";

describe("host errors", () => {
  it("gives each error its own class and code", () => {
    const errors = [
      new HostUnreachableError("x"),
      new HostAuthFailedError("x"),
      new HostVersionMismatchError("x"),
      new HostTimeoutError("x"),
      new HostProtocolError("x"),
    ];
    expect(errors.every((error) => error instanceof RowblyError)).toBe(true);
    expect(errors.map((error) => error.code)).toEqual([
      "HOST_UNREACHABLE",
      "HOST_AUTH_FAILED",
      "HOST_VERSION_MISMATCH",
      "HOST_TIMEOUT",
      "HOST_PROTOCOL",
    ]);
  });

  it.each(["user@host: Permission denied (publickey).", "Host key verification failed."])(
    "classifies exit 255 with %j as auth failed",
    (stderr) => {
      const error = classifySshExit(255, stderr, "host");
      expect(error).toBeInstanceOf(HostAuthFailedError);
      expect(error?.details).toMatchObject({ target: "host", stderr });
    },
  );

  it.each([
    "ssh: Could not resolve hostname nope: Name or service not known",
    "ssh: connect to host 10.0.0.1 port 22: Connection refused",
    "ssh: connect to host 10.0.0.1 port 22: No route to host",
    "ssh: connect to host 10.0.0.1 port 22: Connection timed out",
    "Connection closed by 10.0.0.1 port 22",
    "something else",
  ])("classifies exit 255 with %j as unreachable", (stderr) => {
    expect(classifySshExit(255, stderr, "host")).toBeInstanceOf(HostUnreachableError);
  });

  it("does not classify other exit codes, because the remote command gave them", () => {
    expect(classifySshExit(0, "", "host")).toBeUndefined();
    expect(classifySshExit(1, "Permission denied", "host")).toBeUndefined();
    expect(classifySshExit(null, "", "host")).toBeUndefined();
  });

  it("gives the codes of the host agent errors", async () => {
    const { HostNoFreeSlotError, HostWorkerUnavailableError } = await import("./host-errors.js");
    expect(new HostNoFreeSlotError("full").code).toBe("HOST_NO_FREE_SLOT");
    expect(new HostWorkerUnavailableError("none").code).toBe("HOST_WORKER_UNAVAILABLE");
  });
});
