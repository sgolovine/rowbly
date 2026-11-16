import { type Command, Option } from "commander";
import { getProject } from "../../services/project/project.js";
import {
  createStory,
  deleteStory,
  getStoryDetails,
  type Story,
  type StoryDetails,
  searchStories,
  updateStory,
} from "../../services/story/story.js";
import type { ServiceContext } from "../../services/workspace/workspace.js";
import { collect, formatValue, parseFieldFlags, parseIdList, run } from "../output/output.js";

interface StoryOptions {
  title?: string;
  stage?: string;
  description?: string;
  field?: string[];
  dependsOn?: string[];
  addDependency?: string[];
  removeDependency?: string[];
  tag?: string[];
  addTag?: string[];
  removeTag?: string[];
}

interface SearchOptions {
  stage?: string;
  field?: string[];
  blocked?: boolean;
  ready?: boolean;
  tag?: string[];
}

/** A list of Story IDs or tag values, or `none`. */
function formatIds(ids: readonly string[]): string {
  return ids.length === 0 ? "none" : ids.join(", ");
}

/** The dependency lines of `story get`. */
function dependencyLines(story: StoryDetails): string[] {
  return [
    `Depends on: ${formatIds(story.dependsOn)}`,
    `Blocks: ${formatIds(story.blocks)}`,
    story.waitingFor.length === 0 ? "Blocked: no" : `Blocked: yes (${story.waitingFor.join(", ")})`,
  ];
}

/** The time lines of `story get`, in UTC as they are saved. A missing time shows `—`. */
function timeLines(story: StoryDetails): string[] {
  return [`Created: ${story.createdAt ?? "—"}`, `Updated: ${story.updatedAt ?? "—"}`];
}

async function formatStory(story: StoryDetails, ctx: ServiceContext): Promise<string> {
  const project = await getProject(ctx);
  const stage = project.stages.find((s) => s.key === story.stage);

  return [
    `${story.id}  ${story.title}`,
    `Stage: ${stage?.label ?? story.stage} (${story.stage})`,
    ...dependencyLines(story),
    `Tags: ${formatIds(story.tags)}`,
    ...timeLines(story),
    ...project.customFields.map((field) => `${field.label}: ${formatValue(story.fields[field.key] ?? null)}`),
    ...(story.description ? ["", story.description] : []),
  ].join("\n");
}

function searchText(stories: readonly Story[]): string {
  return stories.length === 0
    ? "No stories found."
    : stories.map((story) => `${story.id.padEnd(8)} ${story.stage.padEnd(14)} ${story.title}`).join("\n");
}

function registerCreate(program: Command): void {
  program
    .command("create")
    .description("Create a story")
    .requiredOption("--title <title>", "story title")
    .option("--stage <stage>", "stage key (default: the first enabled stage)")
    .option("--description <markdown>", "story description")
    .option("--field <key=value>", "set a custom field (repeatable)", collect)
    .option("--depends-on <ids>", "upstream Story IDs, comma-separated (repeatable)", collect)
    .option("--tag <value>", "a tag value (repeatable)", collect)
    .action((opts: StoryOptions & { title: string }, command: Command) =>
      run(
        command,
        (ctx) =>
          createStory(
            {
              title: opts.title,
              stage: opts.stage,
              description: opts.description,
              fields: parseFieldFlags(opts.field),
              dependsOn: parseIdList(opts.dependsOn),
              tags: parseIdList(opts.tag),
            },
            ctx,
          ),
        (story) => `Created ${story.id} in ${story.stage}`,
      ),
    );
}

function registerUpdate(program: Command): void {
  program
    .command("update <id>")
    .description("Update a story")
    .option("--title <title>", "new title")
    .option("--stage <stage>", "move to this stage")
    .option("--description <markdown>", "replace the description")
    .option("--field <key=value>", "set a custom field; an empty value clears it (repeatable)", collect)
    .addOption(
      new Option("--depends-on <ids>", 'replace the upstream Story IDs, comma-separated; "" removes all (repeatable)')
        .argParser(collect)
        .conflicts(["addDependency", "removeDependency"]),
    )
    .option("--add-dependency <id>", "add an upstream Story (repeatable)", collect)
    .option("--remove-dependency <id>", "remove an upstream Story (repeatable)", collect)
    .option("--tag <value>", 'replace the tag values; "" removes all (repeatable)', collect)
    .option("--add-tag <value>", "add a tag value (repeatable)", collect)
    .option("--remove-tag <value>", "remove a tag value (repeatable)", collect)
    .action((id: string, opts: StoryOptions, command: Command) =>
      run(
        command,
        (ctx) =>
          updateStory(
            {
              id,
              title: opts.title,
              stage: opts.stage,
              description: opts.description,
              fields: parseFieldFlags(opts.field),
              dependsOn: parseIdList(opts.dependsOn),
              addDependsOn: parseIdList(opts.addDependency),
              removeDependsOn: parseIdList(opts.removeDependency),
              tags: parseIdList(opts.tag),
              addTags: parseIdList(opts.addTag),
              removeTags: parseIdList(opts.removeTag),
            },
            ctx,
          ),
        (story) => `Updated ${story.id}`,
      ),
    );
}

function registerDelete(program: Command): void {
  program
    .command("delete <id>")
    .description("Delete a story")
    .action((id: string, _opts: unknown, command: Command) =>
      run(
        command,
        (ctx) => deleteStory({ id }, ctx),
        (result) => [`Deleted ${result.id}`, ...result.warnings].join("\n"),
      ),
    );
}

function registerGet(program: Command): void {
  program
    .command("get <id>")
    .description("Show a story")
    .action((id: string, _opts: unknown, command: Command) =>
      run(
        command,
        (ctx) => getStoryDetails({ id }, ctx),
        (story, ctx) => formatStory(story, ctx),
      ),
    );
}

/** The dependency filter of `story search`. Commander refuses `--blocked` together with `--ready`. */
function dependencyFilter(opts: SearchOptions): "blocked" | "ready" | undefined {
  if (opts.blocked) {
    return "blocked";
  }

  return opts.ready ? "ready" : undefined;
}

function registerSearch(program: Command): void {
  program
    .command("search [query]")
    .description("Find stories by text, stage, custom field values or tags")
    .option("--stage <stage>", "only stories in this stage")
    .option("--field <key=value>", "only stories with this field value (repeatable)", collect)
    .addOption(new Option("--blocked", "only blocked stories").conflicts("ready"))
    .option("--ready", "only ready stories")
    .option("--tag <value>", "only stories with this tag (repeatable)", collect)
    .action((query: string | undefined, opts: SearchOptions, command: Command) =>
      run(
        command,
        (ctx) =>
          searchStories(
            {
              query,
              stage: opts.stage,
              fields: parseFieldFlags(opts.field),
              dependency: dependencyFilter(opts),
              tags: parseIdList(opts.tag),
            },
            ctx,
          ),
        (stories) => searchText(stories),
      ),
    );
}

/** Registers the `rowbly story` subcommands on the `story` command. */
export function registerStoryCommands(program: Command): void {
  registerCreate(program);
  registerUpdate(program);
  registerDelete(program);
  registerGet(program);
  registerSearch(program);
}
