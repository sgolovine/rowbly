import type { BytesResult, RemoteCommand } from "../host-transport/host-transport.js";

/** The answer of the fake host to one program, by a key that `answerKey` gives. */
export type FakeHostAnswers = Readonly<Record<string, BytesResult>>;

/** A bytes result with the text on stdout. */
export function output(exitCode: number, text: string, stderr = ""): BytesResult {
  return { exitCode, bytes: Buffer.from(text), stderr };
}

/**
 * The key of a remote command: the program and its first argument, with a remote Rowbly as `rowbly`. For example
 * `uname`, `flock`, `git-version`, `git-config-user.name`, `git-push`, `gh`, `rowbly-version`, `rowbly-auth` and
 * `rowbly-model`.
 */
export function answerKey(command: RemoteCommand): string {
  const [program = "", ...rest] = command;

  if (program.endsWith("/rowbly")) {
    return rest[0] === "--version" ? "rowbly-version" : `rowbly-${rest[1] ?? ""}`;
  }

  if (program === "env") {
    return "git-push";
  }

  if (program === "git") {
    const args = rest[0] === "-C" ? rest.slice(2) : rest;

    return args[0] === "config" ? `git-config-${args[2] ?? ""}` : `git-${args[0]?.replace(/^--/, "") ?? ""}`;
  }

  return program;
}

/** The answers of a host where each check passes, with Rowbly `version` and the provider `anthropic`. */
export function healthyAnswers(version = "0.18.0"): FakeHostAnswers {
  return {
    uname: output(0, "Linux\n"),
    flock: output(0, "flock from util-linux 2.39\n"),
    "git-version": output(0, "git version 2.43.0\n"),
    node: output(0, "v22.19.0\n"),
    npm: output(0, ""),
    "rowbly-version": output(0, `${version}\n`),
    "rowbly-auth": output(0, JSON.stringify([{ id: "anthropic", configured: true, methods: ["oauth"] }])),
    "rowbly-model": output(0, JSON.stringify([{ provider: "anthropic", modelId: "claude-opus-4-5", name: "Opus" }])),
    "git-push": output(0, ""),
    gh: output(0, "", "github.com\n  ✓ Logged in to github.com\n"),
    "git-config-user.name": output(0, "Ada\n"),
    "git-config-user.email": output(0, "ada@example.com\n"),
  };
}

/** Gives the answer of the fake host to a command. A command without an answer exits with code 127. */
export function answerFor(answers: FakeHostAnswers, command: RemoteCommand): BytesResult {
  return answers[answerKey(command)] ?? output(127, "", `${command[0] ?? ""}: not found`);
}
