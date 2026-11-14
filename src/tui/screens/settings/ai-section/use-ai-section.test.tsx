import { Text } from "ink";
import { cleanup } from "ink-testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AuthRuntime } from "../../../../services/agent-auth/agent-auth.js";
import { useTestProject } from "../../../../services/test-project/test-project.js";
import type { ServiceContext } from "../../../../services/workspace/workspace.js";
import { renderTui } from "../../../testing/index.js";
import { useAiSection } from "./use-ai-section.js";

vi.mock("@earendil-works/pi-coding-agent", () => {
  throw new Error("The AI settings test must not load Pi");
});

afterEach(cleanup);

const runtime = {
  getProviders: () => [{ id: "acme", auth: { apiKey: { login: {} } } }],
  listCredentials: async () => [],
  getAvailable: async () => [],
} as unknown as AuthRuntime;

function Probe({ ctx, loadRuntime }: { ctx: ServiceContext; loadRuntime: () => Promise<AuthRuntime> }) {
  const model = useAiSection({ ctx, onChange: () => {}, loadRuntime });

  return (
    <Text>
      page={model.page} ready={String(model.ready)} task={model.task?.kind ?? "none"} signIn={String(model.canSignIn)}
    </Text>
  );
}

describe("useAiSection", () => {
  const project = useTestProject();

  it("loads the providers, signs in on the page of the other providers, and opens the worker limit with l", async () => {
    const tui = await renderTui(<Probe ctx={project.ctx} loadRuntime={async () => runtime} />);

    await vi.waitFor(async () => {
      await tui.press();
      expect(tui.frame()).toContain("page=providers ready=true task=none signIn=false");
    });
    await tui.press("n");

    expect(tui.frame()).toContain("page=addProvider ready=true task=none signIn=true");

    await tui.press("l");

    expect(tui.frame()).toContain("task=limit");
  });

  it("stays not ready when Pi does not load", async () => {
    const tui = await renderTui(
      <Probe
        ctx={project.ctx}
        loadRuntime={async () => {
          throw new Error("no Pi");
        }}
      />,
    );

    await vi.waitFor(async () => {
      await tui.press();
      expect(tui.frame()).toContain("ready=false");
    });
  });
});
