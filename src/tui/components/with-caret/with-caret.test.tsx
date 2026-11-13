import { Text } from "ink";
import { cleanup } from "ink-testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { renderTui } from "../../testing/index.js";
import { WithCaret } from "./with-caret.js";

afterEach(cleanup);

describe("WithCaret", () => {
  it("shows the text with the caret on a character", async () => {
    const tui = await renderTui(
      <Text>
        [<WithCaret text="abc" at={1} />]
      </Text>,
    );
    expect(tui.frame()).toContain("[abc]");
  });

  it("shows a space for a caret after the end", async () => {
    const tui = await renderTui(
      <Text>
        [<WithCaret text="ab" at={2} />]
      </Text>,
    );
    expect(tui.frame()).toContain("[ab ]");
  });
});
