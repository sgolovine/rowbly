import { cleanup } from "ink-testing-library";
import { afterEach, describe, expect, it } from "vitest";
import type { DoctorIssue } from "../../../../services/doctor/doctor.js";
import { renderTui } from "../../../testing/index.js";
import { DoctorReportView } from "./doctor-report.js";

afterEach(cleanup);

const issues = [
  { severity: "error", message: "Bad stage", file: "stories/ROW-1.md", fix: "set the stage" },
  { severity: "warning", message: "Old key", file: "stories/ROW-2.md", fix: "remove it", fixed: true },
  { severity: "warning", message: "Orphan spec", file: "specs/a.md" },
] as DoctorIssue[];

describe("DoctorReportView", () => {
  it("tells that the files agree with the config", async () => {
    const tui = await renderTui(<DoctorReportView issues={[]} ok busy={false} />);

    expect(tui.frame()).toContain("No problems.");
  });

  it("counts the issues and shows each one with its file and fix", async () => {
    const tui = await renderTui(<DoctorReportView issues={issues} ok={false} busy={false} />);

    expect(tui.frame()).toContain("The project has errors. 3 issues, 1 fixed");
    expect(tui.frame()).toContain("✕ Bad stage");
    expect(tui.frame()).toContain("stories/ROW-1.md · fix: set the stage");
    expect(tui.frame()).toContain("✓ Old key");
    expect(tui.frame()).toContain("stories/ROW-2.md · fixed: remove it");
    expect(tui.frame()).toContain("! Orphan spec");
  });

  it("keeps the issues on screen while the checks run again", async () => {
    const tui = await renderTui(<DoctorReportView issues={issues} ok={false} busy />);

    expect(tui.frame()).toContain("Checking the project");
    expect(tui.frame()).toContain("Bad stage");
  });
});
