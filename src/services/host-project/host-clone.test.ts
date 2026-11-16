import { describe, expect, it } from "vitest";
import type { BytesResult, RemoteCommand } from "../host-transport/host-transport.js";
import { createFakeHostTransport } from "../test-project/fake-host-transport.js";
import { CLONE_TIMEOUT_MS, cloneOnHost, cloneStatus, isCleanClone } from "./host-clone.js";

const URL = "git@github.com:o/r.git";
const out = (exitCode: number, text = "", stderr = ""): BytesResult => ({ exitCode, bytes: Buffer.from(text), stderr });

interface Folder {
  readonly repo: boolean;
  readonly origin?: string;
  readonly dirty?: boolean;
}

/** A fake host with folders. Each folder can be a Git work tree with an origin. */
function fakeHost(folders: Record<string, Folder>, clone: BytesResult = out(0)) {
  const commands: RemoteCommand[] = [];
  const options: unknown[] = [];
  const answer = (command: RemoteCommand): BytesResult => {
    const folder = folders[command[2] ?? ""];
    if (command[0] === "test") {
      return out(folder ? 0 : 1);
    }
    if (command[0] === "env") {
      return clone;
    }
    if (!folder?.repo) {
      return out(128, "", "fatal: not a git repository");
    }
    if (command[3] === "rev-parse") {
      return out(0, "true\n");
    }
    if (command[3] === "remote") {
      return folder.origin ? out(0, `${folder.origin}\n`) : out(2, "", "error: No such remote 'origin'");
    }
    return out(0, folder.dirty ? " M a.txt\n" : "");
  };
  const transport = createFakeHostTransport({ bytes: (command) => answer(command) });
  const bytes = transport.bytes.bind(transport);
  const recording = {
    ...transport,
    bytes: (command: RemoteCommand, input: unknown, opts?: unknown) => {
      commands.push(command);
      options.push(opts);
      return bytes(command, input, opts as never);
    },
  };
  return { transport: recording, commands, options };
}

const record = (path: string) => ({ root: "/r", path, managed: true });

describe("host-clone", () => {
  it("gives ok for a clone with the same origin in a different URL form", async () => {
    const { transport } = fakeHost({ repo: { repo: true, origin: "https://github.com/o/r.git" } });

    expect(await cloneStatus(transport, record("repo"), URL)).toEqual({
      state: "ok",
      path: "repo",
      origin: "https://github.com/o/r.git",
    });
  });

  it.each([
    ["missing", {}, null],
    ["not-a-repository", { repo: { repo: false } }, null],
    [
      "different-repository",
      { repo: { repo: true, origin: "https://github.com/o/other.git" } },
      "https://github.com/o/other.git",
    ],
    ["different-repository", { repo: { repo: true } }, null],
  ] as const)("gives %s with the path", async (state, folders, origin) => {
    const { transport } = fakeHost(folders as Record<string, Folder>);

    expect(await cloneStatus(transport, record("repo"), URL)).toEqual({ state, path: "repo", origin });
  });

  it("finds a clean and a dirty clone", async () => {
    const { transport } = fakeHost({ a: { repo: true, origin: URL }, b: { repo: true, origin: URL, dirty: true } });

    expect(await isCleanClone(transport, "a")).toBe(true);
    expect(await isCleanClone(transport, "b")).toBe(false);
  });

  it("clones with fixed tokens, no prompt and a long time limit", async () => {
    const { transport, commands, options } = fakeHost({});

    await cloneOnHost(transport, { url: URL, path: "p/repo", ssh: "u@mini" });

    expect(commands).toEqual([["env", "GIT_TERMINAL_PROMPT=0", "git", "clone", "--", URL, "p/repo"]]);
    expect(options).toEqual([{ timeoutMs: CLONE_TIMEOUT_MS }]);
  });

  it.each([
    "git@github.com: Permission denied (publickey).",
    "fatal: Authentication failed for 'https://github.com/o/r.git/'",
    "fatal: could not read Username for 'https://github.com': terminal prompts disabled",
    "ERROR: Repository not found.",
    "Host key verification failed.",
  ])("gives HOST_GIT_ACCESS for %s", async (stderr) => {
    const { transport } = fakeHost({}, out(128, "", stderr));
    const error = await cloneOnHost(transport, { url: URL, path: "p", ssh: "u@mini" }).catch((caught) => caught);

    expect(error).toMatchObject({ code: "HOST_GIT_ACCESS", details: { stderr, url: URL, target: "u@mini" } });
    expect(error.hint).toContain("ssh u@mini");
    expect(error.hint).toContain(`git ls-remote ${URL}`);
  });

  it("gives HOST_CLONE_FAILED for another failure", async () => {
    const stderr = "fatal: could not create work tree dir 'p': No space left on device";
    const { transport } = fakeHost({}, out(128, "", stderr));
    const error = await cloneOnHost(transport, { url: URL, path: "p", ssh: "u@mini" }).catch((caught) => caught);

    expect(error).toMatchObject({ code: "HOST_CLONE_FAILED", details: { stderr } });
  });
});
