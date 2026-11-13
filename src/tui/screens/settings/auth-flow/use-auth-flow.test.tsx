import { Text } from "ink";
import { cleanup } from "ink-testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AuthRuntime } from "../../../../services/agent-auth/agent-auth.js";
import { keys, renderTui } from "../../../testing/index.js";
import { useAuthFlow } from "./use-auth-flow.js";

vi.mock("@earendil-works/pi-coding-agent", () => {
  throw new Error("The sign-in test must not load Pi");
});

afterEach(cleanup);

function Probe({ onDone }: { onDone: (signedIn: boolean) => void }) {
  const model = useAuthFlow({
    ctx: {},
    runtime: {} as AuthRuntime,
    provider: "acme",
    methods: ["oauth", "api_key"],
    onDone,
  });

  return (
    <Text>
      method={model.method ?? "none"} hints={model.hints.map((h) => h.description).join(",")}
    </Text>
  );
}

describe("useAuthFlow", () => {
  it("asks for the method first, and esc ends the flow before a sign-in starts", async () => {
    const onDone = vi.fn();
    const tui = await renderTui(<Probe onDone={onDone} />);

    expect(tui.frame()).toContain("method=none hints=choose,cancel");

    await tui.press(keys.escape);

    expect(onDone).toHaveBeenCalledWith(false);
  });
});
