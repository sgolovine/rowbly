import {
  checkTagValue,
  type Issue,
  type ProjectConfig,
  projectTags,
  readConfig,
  type TagConfig,
  throwIfIssues,
  writeConfig,
} from "../config/config.js";
import { ConflictError, NotFoundError } from "../errors/errors.js";
import { refuseRemoteWrite } from "../outbox/outbox.js";
import { rewriteStories, tagsOf, withTags } from "../story-files/story-files.js";
import { findProject, type ServiceContext } from "../workspace/workspace.js";

export interface AddTagInput {
  label: string;
  /** The identifier of the tag. It cannot change after the tag is created. */
  value: string;
}

/** The value identifies the tag. Only the label can change. */
export interface UpdateTagInput {
  value: string;
  label: string;
}

/** Gives an issue when the label is empty. */
function labelIssues(label: string): Issue[] {
  return label === "" ? [{ path: ["label"], message: "Label is required" }] : [];
}

function requireTag(config: ProjectConfig, value: string): TagConfig {
  const tags = projectTags(config);
  const tag = tags.find((t) => t.value === value.trim());

  if (!tag) {
    const values = tags.map((t) => t.value).join(", ") || "none";

    throw new NotFoundError(`Tag "${value}" not found. Tags: ${values}`);
  }

  return tag;
}

/** Every tag of the project, in config order. */
export async function listTags(ctx: ServiceContext = {}): Promise<TagConfig[]> {
  return projectTags(await readConfig(await findProject(ctx)));
}

/** Adds a tag to the project. No Story changes. */
export async function addTag(input: AddTagInput, ctx: ServiceContext = {}): Promise<TagConfig> {
  refuseRemoteWrite(ctx, "add a tag");

  const paths = await findProject(ctx);
  const config = await readConfig(paths);
  const label = input.label.trim();
  const value = input.value.trim();

  throwIfIssues("The tag is invalid", [...labelIssues(label), ...checkTagValue(value)]);

  if (projectTags(config).some((tag) => tag.value === value)) {
    throw new ConflictError(`Tag "${value}" already exists`);
  }

  const tag: TagConfig = { value, label };

  await writeConfig(paths, { ...config, tags: [...projectTags(config), tag] });

  return tag;
}

/** Changes the label of a tag. The value and the Stories do not change. */
export async function updateTag(input: UpdateTagInput, ctx: ServiceContext = {}): Promise<TagConfig> {
  refuseRemoteWrite(ctx, "change a tag");

  const paths = await findProject(ctx);
  const config = await readConfig(paths);
  const tag = requireTag(config, input.value);
  const label = input.label.trim();

  throwIfIssues("The tag is invalid", labelIssues(label));

  const updated: TagConfig = { ...tag, label };

  await writeConfig(paths, { ...config, tags: projectTags(config).map((t) => (t === tag ? updated : t)) });

  return updated;
}

/** The frontmatter without the tag value, or `false` when the Story does not have the tag. */
function withoutTag(data: Record<string, unknown>, value: string): Record<string, unknown> | false {
  const tags = tagsOf(data);

  return tags.includes(value)
    ? withTags(
        data,
        tags.filter((tag) => tag !== value),
      )
    : false;
}

/** Removes a tag from the project and from the `tags` list of each Story that has it. */
export async function removeTag(input: { value: string }, ctx: ServiceContext = {}): Promise<TagConfig> {
  refuseRemoteWrite(ctx, "remove a tag");

  const paths = await findProject(ctx);
  const config = await readConfig(paths);
  const tag = requireTag(config, input.value);
  const next = { ...config, tags: projectTags(config).filter((t) => t !== tag) };

  await writeConfig(paths, next);
  await rewriteStories(paths, next, (data) => withoutTag(data, tag.value), ctx.now?.() ?? new Date());

  return tag;
}
