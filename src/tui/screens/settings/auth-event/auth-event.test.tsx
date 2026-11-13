import { cleanup } from "ink-testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { renderTui } from "../../../testing/index.js";
import { AuthEventView } from "./auth-event.js";

afterEach(cleanup);

describe("AuthEventView", () => {
  it("shows a URL to open and a device code", async () => {
    const url = await renderTui(<AuthEventView event={{ type: "auth_url", url: "https://x.test/a" }} />);

    expect(url.frame()).toContain("Open this URL in a browser:");
    expect(url.frame()).toContain("https://x.test/a");

    const code = await renderTui(
      <AuthEventView event={{ type: "device_code", verificationUri: "https://x.test/d", userCode: "AB-12" }} />,
    );

    expect(code.frame()).toContain("enter the code");
    expect(code.frame()).toContain("AB-12");
  });

  it("shows information with its links, and progress", async () => {
    const info = await renderTui(
      <AuthEventView
        event={{ type: "info", message: "Read this", links: [{ label: "Docs", url: "https://x.test" }] }}
      />,
    );

    expect(info.frame()).toContain("Read this");
    expect(info.frame()).toContain("Docs: https://x.test");

    const progress = await renderTui(<AuthEventView event={{ type: "progress", message: "Waiting…" }} />);

    expect(progress.frame()).toContain("Waiting…");
  });
});
