import { describe, expect, it } from "vitest";
import { HostCloneFailedError, HostGitAccessError } from "./host-project-errors.js";

describe("host-project-errors", () => {
  it("gives the error codes", () => {
    expect(new HostGitAccessError("x").code).toBe("HOST_GIT_ACCESS");
    expect(new HostCloneFailedError("x").code).toBe("HOST_CLONE_FAILED");
  });
});
