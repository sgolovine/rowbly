import { cleanup } from "ink-testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { renderTui } from "../../testing/index.js";
import { ConversationNotice } from "./conversation-notice.js";

afterEach(cleanup);

describe("ConversationNotice", () => {
  it("says why the view shows no entries", async () => {
    expect((await renderTui(<ConversationNotice status="loading" />)).frame()).toContain("Loading the conversation…");
    cleanup();
    expect((await renderTui(<ConversationNotice status="missing" />)).frame()).toContain("No conversation yet.");
    cleanup();
    expect((await renderTui(<ConversationNotice status="unsupported" />)).frame()).toContain(
      "Rowbly cannot show this session format.",
    );
  });

  it("shows the message of a read that failed", async () => {
    const tui = await renderTui(<ConversationNotice status="error" error="disk full" />);

    expect(tui.frame()).toContain("Rowbly cannot read the conversation: disk full");
  });
});
