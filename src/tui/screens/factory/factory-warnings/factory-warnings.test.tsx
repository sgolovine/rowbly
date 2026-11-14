import { cleanup } from "ink-testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderTui } from "../../../testing/index.js";
import type { FactoryAttention } from "../factory-modal/use-factory-attention.js";
import type { FactoryProblem } from "../factory-status.js";
import { FactoryWarnings } from "./factory-warnings.js";

afterEach(cleanup);

const commit: FactoryProblem = {
  key: "attention:commit",
  kind: "attention",
  title: "commit",
  text: "Canonical commit: failed",
  message: "Canonical commit: failed",
  attentionKey: "commit",
  dismissible: true,
};

function attention(overrides: Partial<FactoryAttention> = {}): FactoryAttention {
  return {
    problems: [commit],
    listOpen: true,
    problem: undefined,
    story: undefined,
    thread: undefined,
    busy: false,
    can: { story: false, thread: false, dismiss: true },
    actions: {
      openList: vi.fn(),
      closeList: vi.fn(),
      pick: vi.fn(),
      closeDetail: vi.fn(),
      openStory: vi.fn(),
      openThread: vi.fn(),
      dismiss: vi.fn(),
      setFiltering: vi.fn(),
    },
    ...overrides,
  };
}

describe("FactoryWarnings", () => {
  it("shows the list while no warning is open", async () => {
    const tui = await renderTui(<FactoryWarnings attention={attention()} height={30} active />);

    expect(tui.frame()).toContain("Canonical commit: failed");
    expect(tui.frame()).not.toContain("Attention entry");
  });

  it("shows the detail view of the open warning", async () => {
    const tui = await renderTui(<FactoryWarnings attention={attention({ problem: commit })} height={30} active />);

    expect(tui.frame()).toContain("Attention entry");
    expect(tui.frame()).toContain("Dismiss");
  });
});
