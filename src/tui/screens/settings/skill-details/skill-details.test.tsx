import { cleanup } from "ink-testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { renderTui } from "../../../testing/index.js";
import { SkillDetails } from "./skill-details.js";

afterEach(cleanup);

describe("SkillDetails", () => {
  it("shows each tracked harness with its state and path", async () => {
    const tui = await renderTui(
      <SkillDetails
        name="develop"
        bundled
        tracked={{
          name: "develop",
          harnesses: [
            { harness: "codex", path: ".agents/skills/develop", installed: true },
            { harness: "cursor", path: ".cursor/skills/develop", installed: false },
          ],
        }}
      />,
    );

    expect(tui.frame()).toContain("codex · installed");
    expect(tui.frame()).toContain(".agents/skills/develop");
    expect(tui.frame()).toContain("cursor · missing");
    expect(tui.frame()).not.toContain("Not installed.");
  });

  it("tells when a skill is not installed or no longer bundled", async () => {
    const tui = await renderTui(<SkillDetails name="old" bundled={false} tracked={undefined} />);

    expect(tui.frame()).toContain("No longer bundled");
    expect(tui.frame()).toContain("Not installed.");
  });
});
