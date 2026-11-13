import { isCancel, log, password, select, text } from "@clack/prompts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCliAuthInteraction } from "./authWizard.js";

vi.mock("@clack/prompts", () => ({
  isCancel: vi.fn(() => false),
  log: { info: vi.fn() },
  password: vi.fn(),
  select: vi.fn(),
  text: vi.fn(),
}));
afterEach(() => vi.clearAllMocks());
describe("CLI auth interaction", () => {
  it("masks secrets and adapts selections, manual callbacks and device notifications", async () => {
    const interaction = createCliAuthInteraction();
    vi.mocked(password).mockResolvedValue("key");
    vi.mocked(select).mockResolvedValue("device");
    vi.mocked(text).mockResolvedValue("callback");
    expect(await interaction.prompt({ type: "secret", message: "Key" })).toBe("key");
    expect(text).not.toHaveBeenCalled();
    expect(
      await interaction.prompt({ type: "select", message: "Method", options: [{ id: "device", label: "Device" }] }),
    ).toBe("device");
    expect(await interaction.prompt({ type: "manual_code", message: "Code" })).toBe("callback");
    interaction.notify({ type: "device_code", userCode: "CODE", verificationUri: "https://example.test" });
    expect(log.info).toHaveBeenCalledWith("https://example.test\nCode: CODE");
  });
  it("aborts the flow on cancel and honors callback cancellation", async () => {
    const interaction = createCliAuthInteraction();
    vi.mocked(isCancel).mockReturnValueOnce(true);
    await expect(interaction.prompt({ type: "text", message: "Cancel" })).rejects.toThrow("cancelled");
    expect(interaction.signal?.aborted).toBe(true);
    const callback = new AbortController();
    callback.abort();
    await expect(
      createCliAuthInteraction().prompt({ type: "manual_code", message: "Code", signal: callback.signal }),
    ).rejects.toThrow();
  });
});
