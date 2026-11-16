import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { sshArguments, sshSettings } from "../host-transport/ssh-transport.js";
import { useTempDir, useTestProject } from "../test-project/test-project.js";
import { RC_FILE } from "../user-rc/user-rc.js";
import { hostLogin, hostLoginArguments } from "./host-login.js";

const EXE = ".local/share/rowbly/versions/0.18.0/node_modules/.bin/rowbly";

describe("host login", () => {
  const p = useTestProject();
  const control = useTempDir();

  it("gives -t, the -o options of each SSH call, --, the target and the remote auth login", () => {
    const settings = sshSettings({ target: "u@mini", controlDir: "/tmp/c" });
    const options = sshArguments(settings, ["true"]).slice(0, -3);

    expect(hostLoginArguments(settings, EXE)).toEqual(["-t", ...options, "--", "u@mini", EXE, "auth", "login"]);
    expect(options).toContain("BatchMode=yes");
  });

  it("refuses a bad target and a bad executable token", () => {
    expect(() => hostLoginArguments(sshSettings({ target: "-oProxyCommand=x" }), EXE)).toThrow(/not valid/);
    expect(() => hostLoginArguments(sshSettings({ target: "u@mini" }), "bad path")).toThrow(/not safe/);
  });

  it("finds the host and gives the process, or NOT_FOUND", async () => {
    const deps = {
      build: async () => ({ id: "0.18.0", version: "0.18.0", released: true }),
      ssh: { controlDir: control.path },
    };

    await writeFile(
      join(p.ctx.home as string, RC_FILE),
      JSON.stringify({ hosts: [{ id: "mini", ssh: "u@mini", maxWorkers: 1, enabled: true }] }),
    );

    const login = await hostLogin({ id: "mini" }, p.ctx, deps);

    expect(login).toMatchObject({ host: "mini", executable: "ssh" });
    expect(login.args.slice(-5)).toEqual(["--", "u@mini", EXE, "auth", "login"]);
    await expect(hostLogin({ id: "other" }, p.ctx, deps)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
