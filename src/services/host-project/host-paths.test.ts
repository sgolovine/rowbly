import { describe, expect, it } from "vitest";
import { hostProjectId, managedClonePath, remoteClonePath, remoteWorktreesDir } from "./host-paths.js";

describe("host-paths", () => {
  it("gives a dash-case name and 12 hex characters of the hash of the root", () => {
    expect(hostProjectId("/home/u/My Project")).toMatch(/^my-project-[0-9a-f]{12}$/);
    expect(hostProjectId("/a/rowbly")).not.toBe(hostProjectId("/b/rowbly"));
    expect(hostProjectId("/a/rowbly")).toBe(hostProjectId("/a/rowbly"));
  });

  it("gives the managed clone below the Rowbly root of the host", () => {
    expect(managedClonePath("/a/rowbly")).toBe(`.local/share/rowbly/projects/${hostProjectId("/a/rowbly")}/repo`);
  });

  it("puts the worktrees next to the clone", () => {
    expect(remoteWorktreesDir("work/rowbly")).toBe("work/rowbly-worktrees");
  });

  it("makes a leading ~/ relative to the home folder and keeps an absolute path", () => {
    expect(remoteClonePath("~/work/rowbly/")).toBe("work/rowbly");
    expect(remoteClonePath("/srv/rowbly")).toBe("/srv/rowbly");
  });

  it.each(["", "~/", "~/a b", "work/$(x)", "-x", "~user/r", "a;b"])("refuses %j with VALIDATION", (path) => {
    expect(() => remoteClonePath(path)).toThrow(expect.objectContaining({ code: "VALIDATION" }));
  });
});
