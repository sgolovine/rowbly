import { describe, expect, it } from "vitest";
import { readConfig } from "../config/config.js";
import { ConflictError, NotFoundError, ValidationError } from "../errors/errors.js";
import { updateProject } from "../project/project.js";
import { createStory, deleteStory } from "../story/story.js";
import { useTestProject } from "../testProject/testProject.js";
import { createSpec, deleteSpec, getSpec, linkSpec, listSpecs, unlinkSpec, updateSpec } from "./spec.js";

describe("spec", () => {
  const project = useTestProject();
  const specsOn = async () => {
    await updateProject({ features: { specs: true } }, project.ctx);
    await createStory({ title: "Login" }, project.ctx);
    await createStory({ title: "Logout" }, project.ctx);
  };

  it("refuses every operation while Specs are off", async () => {
    await createStory({ title: "Login" }, project.ctx);
    await expect(createSpec({ title: "Design", stories: ["ROW-01"] }, project.ctx)).rejects.toThrow(ConflictError);
    await expect(listSpecs({}, project.ctx)).rejects.toThrow(/turned off/);
  });

  describe("createSpec", () => {
    it("writes the spec with its title, its Stories and its body", async () => {
      await specsOn();
      const spec = await createSpec(
        { title: " Login Page ", stories: ["row-1"], body: "# Scope\n\nSSO." },
        project.ctx,
      );
      expect(spec).toEqual({
        slug: "login-page",
        title: "Login Page",
        stories: ["ROW-01"],
        body: "# Scope\n\nSSO.",
        path: expect.stringMatching(/specs[/\\]login-page\.md$/),
      });
      expect(await project.read("specs/login-page.md")).toBe(
        "---\ntitle: Login Page\nstories:\n  - ROW-01\n---\n\n# Scope\n\nSSO.\n",
      );
    });

    it("adds a number to a slug from the title that is taken, and refuses a given slug that is taken", async () => {
      await specsOn();
      await createSpec({ title: "Design", stories: ["1"] }, project.ctx);
      expect((await createSpec({ title: "Design", stories: ["2"] }, project.ctx)).slug).toBe("design-2");
      await expect(createSpec({ title: "X", slug: "design", stories: ["1"] }, project.ctx)).rejects.toThrow(
        ConflictError,
      );
    });

    it("needs a title, a valid slug and at least one Story that exists", async () => {
      await specsOn();
      const error = await createSpec({ title: " ", slug: "Bad Slug", stories: [] }, project.ctx).catch((e) => e);
      expect(error).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).details.issues).toEqual([
        { path: ["title"], message: "Title is required" },
        { path: ["slug"], message: expect.stringMatching(/Slug "Bad Slug"/) },
        { path: ["stories"], message: "A spec must be linked to at least one Story" },
      ]);
      await expect(createSpec({ title: "T", stories: ["ROW-09"] }, project.ctx)).rejects.toThrow(/Story ROW-09/);
    });
  });

  it("lists every spec, or the specs of one Story", async () => {
    await specsOn();
    await createSpec({ title: "B", stories: ["ROW-01", "ROW-02"] }, project.ctx);
    await createSpec({ title: "A", stories: ["ROW-01"] }, project.ctx);
    expect((await listSpecs({}, project.ctx)).map((s) => s.slug)).toEqual(["a", "b"]);
    expect((await listSpecs({ story: "2" }, project.ctx)).map((s) => s.slug)).toEqual(["b"]);
    await expect(listSpecs({ story: "ROW-09" }, project.ctx)).rejects.toThrow(NotFoundError);
  });

  it("updates the title, the body and the Stories", async () => {
    await specsOn();
    await createSpec({ title: "Design", stories: ["ROW-01"], body: "Old" }, project.ctx);
    const spec = await updateSpec({ slug: "design", title: "New", body: "Body", stories: ["ROW-02"] }, project.ctx);
    expect(spec).toMatchObject({ slug: "design", title: "New", body: "Body", stories: ["ROW-02"] });
    expect(await getSpec({ slug: "DESIGN" }, project.ctx)).toEqual(spec);
    await expect(updateSpec({ slug: "design", stories: [] }, project.ctx)).rejects.toThrow(ValidationError);
    await expect(updateSpec({ slug: "nope", title: "X" }, project.ctx)).rejects.toThrow(NotFoundError);
  });

  it("links and unlinks Stories, but keeps the last link", async () => {
    await specsOn();
    await createSpec({ title: "Design", stories: ["ROW-01"] }, project.ctx);
    expect((await linkSpec({ slug: "design", story: "2" }, project.ctx)).stories).toEqual(["ROW-01", "ROW-02"]);
    expect((await linkSpec({ slug: "design", story: "ROW-02" }, project.ctx)).stories).toEqual(["ROW-01", "ROW-02"]);
    expect((await unlinkSpec({ slug: "design", story: "row-1" }, project.ctx)).stories).toEqual(["ROW-02"]);
    await expect(unlinkSpec({ slug: "design", story: "ROW-01" }, project.ctx)).rejects.toThrow(NotFoundError);
    await expect(unlinkSpec({ slug: "design", story: "ROW-02" }, project.ctx)).rejects.toThrow(/only Story/);
  });

  it("deletes a spec", async () => {
    await specsOn();
    await createSpec({ title: "Design", stories: ["ROW-01"] }, project.ctx);
    expect(await deleteSpec({ slug: "design" }, project.ctx)).toEqual({ slug: "design" });
    expect(await listSpecs({}, project.ctx)).toEqual([]);
  });

  it("follows a deleted Story and a new project key", async () => {
    await specsOn();
    await createSpec({ title: "Design", stories: ["ROW-01", "ROW-02"] }, project.ctx);
    await deleteStory({ id: "ROW-01" }, project.ctx);
    expect((await getSpec({ slug: "design" }, project.ctx)).stories).toEqual(["ROW-02"]);
    await updateProject({ key: "WEB" }, project.ctx);
    expect((await getSpec({ slug: "design" }, project.ctx)).stories).toEqual(["WEB-02"]);
    expect((await readConfig(project.paths)).features).toEqual({ specs: true });
  });
});
