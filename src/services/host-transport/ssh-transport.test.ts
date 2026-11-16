import { chmod, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ValidationError } from "../errors/errors.js";
import { useTempDir } from "../test-project/test-project.js";
import { HostAuthFailedError, HostProtocolError, HostTimeoutError, HostUnreachableError } from "./host-errors.js";
import type { ChannelEnd } from "./host-transport.js";
import { createSshTransport, sshArguments, sshSettings, validateCommand } from "./ssh-transport.js";

const COMMAND = ["/opt/rowbly/bin/rowbly", "host", "attach"];

interface Recorded {
  args: string[];
  stdin: string;
}

/**
 * Writes a stub `ssh` executable. It records its arguments and stdin to `record.json`, then runs `body`.
 * `body` can use `fs`, `args` and `stdin`.
 */
async function writeStub(dir: string, body: string, readStdin = true): Promise<string> {
  const path = join(dir, "ssh-stub");
  const record = join(dir, "record.json");
  const script = [
    `#!${process.execPath}`,
    'const fs = require("node:fs");',
    "const args = process.argv.slice(2);",
    readStdin ? 'const stdin = fs.readFileSync(0, "utf8");' : 'const stdin = "";',
    `fs.writeFileSync(${JSON.stringify(record)}, JSON.stringify({ args, stdin }));`,
    body,
  ].join("\n");
  await writeFile(path, script);
  await chmod(path, 0o755);
  return path;
}

async function readRecord(dir: string): Promise<Recorded> {
  return JSON.parse(await readFile(join(dir, "record.json"), "utf8"));
}

function channelEnd(): { promise: Promise<ChannelEnd>; resolve: (end: ChannelEnd) => void } {
  let resolve: (end: ChannelEnd) => void = () => {};
  const promise = new Promise<ChannelEnd>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function transportFor(dir: string, sshExecutable: string, target = "worker@box") {
  return createSshTransport({ target, sshExecutable, controlDir: join(dir, "control") });
}

describe("ssh transport", () => {
  const dir = useTempDir();

  it("gives the SSH options, then --, the target and the command tokens", async () => {
    const stub = await writeStub(dir.path, 'process.stdout.write("{}");');
    await transportFor(dir.path, stub).request(COMMAND, {});
    const { args } = await readRecord(dir.path);
    const control = join(dir.path, "control");
    expect(args).toEqual([
      "-o",
      "BatchMode=yes",
      "-o",
      "ServerAliveInterval=15",
      "-o",
      "ServerAliveCountMax=3",
      "-o",
      "ControlMaster=auto",
      "-o",
      `ControlPath=${join(control, "%C")}`,
      "-o",
      "ControlPersist=60",
      "--",
      "worker@box",
      ...COMMAND,
    ]);
    expect((await stat(control)).mode & 0o777).toBe(0o700);
  });

  it("sends the data on stdin and does not change the arguments for a different payload", async () => {
    const stub = await writeStub(dir.path, "process.stdout.write(stdin);");
    const transport = transportFor(dir.path, stub);
    const hostile = { title: 'It\'s "quoted" $HOME; rm -rf / `id`\nnext line' };

    const first = await transport.request(COMMAND, hostile);
    const firstRecord = await readRecord(dir.path);
    await transport.request(COMMAND, { title: "plain" });
    const secondRecord = await readRecord(dir.path);

    expect(first).toEqual({ exitCode: 0, value: hostile, stderr: "" });
    expect(JSON.parse(firstRecord.stdin)).toEqual(hostile);
    expect(firstRecord.args).toEqual(secondRecord.args);
    expect(firstRecord.args.join(" ")).not.toContain("quoted");
  });

  it.each([
    ["a token with a space", ["rowbly", "host attach"]],
    ["a token with a $", ["rowbly", "$HOME"]],
    ["a token with a ;", ["rowbly;id"]],
    ["a token with a quote", ["rowbly'"]],
    ["a token with a double quote", ['rowbly"']],
    ["a token with a backtick", ["rowbly`id`"]],
    ["an empty token", ["rowbly", ""]],
    ["no tokens", []],
  ])("refuses %s before SSH starts", async (_name, command) => {
    const stub = await writeStub(dir.path, "");
    await expect(transportFor(dir.path, stub).request(command, {})).rejects.toBeInstanceOf(ValidationError);
    await expect(
      transportFor(dir.path, stub).channel(command, { onFrame: () => {}, onClose: () => {} }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(readRecord(dir.path)).rejects.toThrow();
  });

  it("accepts a token with @, for example an npm package spec", () => {
    expect(() => validateCommand(["npm", "install", "rowbly@0.18.0"])).not.toThrow();
    expect(sshArguments(sshSettings({ target: "worker@box" }), ["npm", "rowbly@1.0.0"]).at(-1)).toBe("rowbly@1.0.0");
  });

  it.each([
    ["a space", "rowbly@1 x"],
    ["a $", "rowbly@$V"],
    ["a ;", "rowbly@1;id"],
    ["a quote", "rowbly@'1'"],
    ["a backtick", "rowbly@`id`"],
  ])("refuses a token with @ and %s", (_name, token) => {
    expect(() => validateCommand(["npm", token])).toThrow(ValidationError);
  });

  it("uploads the exact bytes on stdin and gives the exit code and stderr", async () => {
    const data = Buffer.from([...Array.from({ length: 256 }, (_, index) => index), 0x0a, 0x00, 0xff]);
    const out = join(dir.path, "upload.bin");
    const stub = await writeStub(
      dir.path,
      [
        "const chunks = [];",
        'process.stdin.on("data", (chunk) => chunks.push(chunk));',
        `process.stdin.on("end", () => { fs.writeFileSync(${JSON.stringify(out)}, Buffer.concat(chunks)); process.stderr.write("done"); process.exit(4); });`,
      ].join("\n"),
      false,
    );
    const result = await transportFor(dir.path, stub).upload(["dd", "of=file.tgz", "status=none"], data);
    expect(result).toEqual({ exitCode: 4, stderr: "done" });
    expect(Buffer.compare(await readFile(out), data)).toBe(0);
    expect((await readRecord(dir.path)).args.slice(-3)).toEqual(["dd", "of=file.tgz", "status=none"]);
  });

  it.each(["-oProxyCommand=id", "user@host name", "host\tname", "host\u0001", "host\u007f", ""])(
    "refuses the target %j",
    (target) => {
      expect(() => createSshTransport({ target })).toThrow(ValidationError);
      expect(() => sshArguments(sshSettings({ target }), COMMAND)).toThrow(ValidationError);
    },
  );

  it("gives the exit code and stderr of the remote command", async () => {
    const stub = await writeStub(dir.path, 'process.stderr.write("no such story"); process.exit(3);');
    await expect(transportFor(dir.path, stub).request(COMMAND, {})).resolves.toEqual({
      exitCode: 3,
      value: undefined,
      stderr: "no such story",
    });
  });

  it("classifies exit 255 with an auth failure", async () => {
    const stub = await writeStub(
      dir.path,
      'process.stderr.write("worker@box: Permission denied (publickey).\\n"); process.exit(255);',
    );
    const error = await transportFor(dir.path, stub)
      .request(COMMAND, {})
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(HostAuthFailedError);
    expect(error).toMatchObject({ code: "HOST_AUTH_FAILED" });
  });

  it("classifies exit 255 with an unreachable host", async () => {
    const stub = await writeStub(
      dir.path,
      'process.stderr.write("ssh: Could not resolve hostname box: Name or service not known\\n"); process.exit(255);',
    );
    await expect(transportFor(dir.path, stub).request(COMMAND, {})).rejects.toMatchObject({ code: "HOST_UNREACHABLE" });
  });

  it("gives the unreachable error when the SSH executable does not exist", async () => {
    const transport = transportFor(dir.path, join(dir.path, "missing-ssh"));
    await expect(transport.request(COMMAND, {})).rejects.toBeInstanceOf(HostUnreachableError);
  });

  it("stops the call and gives the timeout error after the time limit", async () => {
    const stub = await writeStub(dir.path, "setTimeout(() => {}, 10000);");
    const started = Date.now();
    await expect(transportFor(dir.path, stub).request(COMMAND, {}, { timeoutMs: 200 })).rejects.toBeInstanceOf(
      HostTimeoutError,
    );
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it("gives a protocol error when the output is not JSON", async () => {
    const stub = await writeStub(dir.path, 'process.stdout.write("{bad json");');
    await expect(transportFor(dir.path, stub).request(COMMAND, {})).rejects.toBeInstanceOf(HostProtocolError);
  });

  it("returns the exact bytes of a bytes call", async () => {
    const stub = await writeStub(
      dir.path,
      "process.stdout.write(Buffer.from(Array.from({ length: 256 }, (_, index) => index)));",
    );
    const result = await transportFor(dir.path, stub).bytes(COMMAND, { attachment: "a.png" });
    expect(result.exitCode).toBe(0);
    expect([...result.bytes]).toEqual(Array.from({ length: 256 }, (_, index) => index));
    expect(JSON.parse((await readRecord(dir.path)).stdin)).toEqual({ attachment: "a.png" });
  });

  it("fails a bytes call when the output is larger than the limit", async () => {
    const stub = await writeStub(dir.path, "process.stdout.write(Buffer.alloc(2048, 1));");
    await expect(transportFor(dir.path, stub).bytes(COMMAND, {}, { limit: 1024 })).rejects.toThrow(
      /larger than the limit/,
    );
  });

  it("streams frames in both directions on a channel", async () => {
    const stub = await writeStub(
      dir.path,
      [
        'process.stdout.write(JSON.stringify({ type: "hello" }) + "\\n");',
        'require("node:readline").createInterface({ input: process.stdin }).on("line", (line) => {',
        "  const frame = JSON.parse(line);",
        "  if (frame.stop) { process.exit(0); }",
        '  process.stdout.write(JSON.stringify({ echo: frame }) + "\\n");',
        "});",
      ].join("\n"),
      false,
    );
    const frames: unknown[] = [];
    const ended = channelEnd();
    const channel = await transportFor(dir.path, stub).channel(COMMAND, {
      onFrame: (frame) => frames.push(frame),
      onClose: ended.resolve,
    });
    channel.send({ text: "a;b `c`\n$d" });
    channel.send({ stop: true });
    expect(await ended.promise).toEqual({ exitCode: 0 });
    expect(frames).toEqual([{ type: "hello" }, { echo: { text: "a;b `c`\n$d" } }]);
  });

  it("closes a channel with a protocol error after a bad line", async () => {
    const stub = await writeStub(
      dir.path,
      'process.stdout.write("{\\"ok\\":1}\\n{bad\\n{\\"ok\\":2}\\n"); setTimeout(() => {}, 10000);',
      false,
    );
    const frames: unknown[] = [];
    const ended = channelEnd();
    await transportFor(dir.path, stub).channel(COMMAND, {
      onFrame: (frame) => frames.push(frame),
      onClose: ended.resolve,
    });
    const end = await ended.promise;
    expect(end.error).toBeInstanceOf(HostProtocolError);
    expect(frames).toEqual([{ ok: 1 }]);
  });

  it("closes a channel with a protocol error after a line that is too long", async () => {
    const stub = await writeStub(
      dir.path,
      'process.stdout.write("x".repeat(200)); setTimeout(() => {}, 10000);',
      false,
    );
    const ended = channelEnd();
    await transportFor(dir.path, stub).channel(
      COMMAND,
      { onFrame: () => {}, onClose: ended.resolve },
      { lineLimit: 100 },
    );
    expect((await ended.promise).error).toMatchObject({ code: "HOST_PROTOCOL" });
  });

  it("closes a channel with the unreachable error when SSH fails", async () => {
    const stub = await writeStub(
      dir.path,
      'process.stderr.write("Connection closed by 10.0.0.1 port 22\\n"); process.exit(255);',
      false,
    );
    const ended = channelEnd();
    await transportFor(dir.path, stub).channel(COMMAND, { onFrame: () => {}, onClose: ended.resolve });
    expect((await ended.promise).error).toBeInstanceOf(HostUnreachableError);
  });
});
