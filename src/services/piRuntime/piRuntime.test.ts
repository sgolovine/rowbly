import { mkdir, readFile } from "node:fs/promises";
import net from "node:net";
import { join } from "node:path";
import { fauxAssistantMessage, fauxProvider, fauxToolCall, InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTempDir } from "../testProject/testProject.js";
import { createPiSession, loadPi, type PiSession } from "./piRuntime.js";

describe("Pi runtime", () => {
  const dir = useTempDir();
  const sessions: PiSession[] = [];
  beforeEach(() => {
    vi.stubEnv("PI_OFFLINE", "1");
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        throw new Error("Unexpected fetch");
      }),
    );
    vi.spyOn(net.Socket.prototype, "connect").mockImplementation(() => {
      throw new Error("Unexpected socket");
    });
  });
  afterEach(async () => {
    for (const session of sessions.splice(0)) await session.close();
    expect(fetch).not.toHaveBeenCalled();
    expect(net.Socket.prototype.connect).not.toHaveBeenCalled();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  async function fixture(name: string) {
    const sdk = await loadPi();
    const cwd = join(dir.path, name);
    await mkdir(cwd);
    const runtime = await sdk.ModelRuntime.create({
      credentials: new InMemoryCredentialStore(),
      modelsPath: null,
      refreshOnCreate: false,
      allowModelNetwork: false,
    });
    const faux = fauxProvider({ tokenSize: { min: 1000, max: 1000 } });
    runtime.registerNativeProvider(faux.provider);
    const sessionManager = sdk.SessionManager.create(cwd, join(cwd, "sessions"));
    const managed = await createPiSession({
      cwd,
      agentDir: join(cwd, "agent"),
      modelRuntime: runtime,
      model: faux.getModel(),
      thinkingLevel: "off",
      sessionManager,
      tools: ["echo_local"],
      customTools: [
        sdk.defineTool({
          name: "echo_local",
          label: "Echo",
          description: "Echo local text",
          parameters: Type.Object({ text: Type.String() }),
          async execute(_id, args) {
            return { content: [{ type: "text", text: args.text }], details: {} };
          },
        }),
      ],
    });
    sessions.push(managed);
    return { managed, faux, sessionManager };
  }

  it("creates two independent faux sessions and persists tool calls and results", async () => {
    const a = await fixture("a");
    const b = await fixture("b");
    a.faux.setResponses([
      fauxAssistantMessage(fauxToolCall("echo_local", { text: "local" }, { id: "echo-1" }), { stopReason: "toolUse" }),
      fauxAssistantMessage("Done"),
    ]);
    b.faux.setResponses([fauxAssistantMessage("Independent")]);
    let settled = false;
    a.managed.session.subscribe((event) => {
      if (event.type === "agent_settled") settled = true;
    });
    await Promise.all([a.managed.prompt("A"), b.managed.prompt("B")]);
    expect(settled).toBe(true);
    expect(a.sessionManager.getSessionId()).not.toBe(b.sessionManager.getSessionId());
    expect(a.managed.session.getLastAssistantText()).toBe("Done");
    expect(b.managed.session.getLastAssistantText()).toBe("Independent");
    const file = a.sessionManager.getSessionFile();
    if (!file) throw new Error("Missing session file");
    const text = await readFile(file, "utf8");
    expect(text).toContain('"type":"toolCall"');
    expect(text).toContain('"role":"toolResult"');
  });

  it("reports assistant errors after a resolved prompt", async () => {
    const f = await fixture("error");
    f.faux.setResponses([fauxAssistantMessage("", { stopReason: "error", errorMessage: "429 rate limit" })]);
    await expect(f.managed.prompt("Fail")).rejects.toMatchObject({ code: "PI_PROMPT", message: "429 rate limit" });
  });

  it("waits for idle before disposal and closes once", async () => {
    const f = await fixture("close");
    const order: string[] = [];
    vi.spyOn(f.managed.session, "abort").mockImplementation(async () => {
      order.push("abort");
    });
    vi.spyOn(f.managed.session, "waitForIdle").mockImplementation(async () => {
      order.push("idle");
    });
    const dispose = vi.spyOn(f.managed.session, "dispose");
    dispose.mockImplementation(() => {
      order.push("dispose");
    });
    await Promise.all([f.managed.close(), f.managed.close()]);
    expect(order).toEqual(["abort", "idle", "dispose"]);
  });
});
