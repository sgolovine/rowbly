import type { Command } from "commander";
import { getProject } from "../../services/project/project.js";
import {
  createStory,
  deleteStory,
  getStory,
  lockStory,
  type Story,
  searchStories,
  unlockStory,
  updateStory,
} from "../../services/story/story.js";
import type { ServiceContext } from "../../services/workspace/workspace.js";
import { collect, formatValue, parseFieldFlags, parsePosition, run } from "../output/output.js";

interface StoryOptions {
  title?: string;
  stage?: string;
  position?: number;
  description?: string;
  field?: string[];
}

async function formatStory(story: Story, ctx: ServiceContext): Promise<string> {
  const project = await getProject(ctx);
  const stage = project.stages.find((s) => s.key === story.stage);
  const lines = [`${story.id}  ${story.title}`, `Stage: ${stage?.label ?? story.stage} (${story.stage})`];
  if (story.agentLock) lines.push(`Agent lock: ${story.agentLock.agent} (since ${story.agentLock.lockedAt})`);
  for (const field of project.customFields)
    lines.push(`${field.label}: ${formatValue(story.fields[field.key] ?? null)}`);
  if (story.description) lines.push("", story.description);
  return lines.join("\n");
}

export function registerStoryCommands(program: Command): void {
  program
    .command("create")
    .description("Create a story")
    .requiredOption("--title <title>", "story title")
    .option("--stage <stage>", "stage key (default: the first enabled stage)")
    .option("--description <markdown>", "story description")
    .option("--field <key=value>", "set a custom field (repeatable)", collect)
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
            },
            ctx,
          ),
        (story) => `Created ${story.id} in ${story.stage}`,
      ),
    );

  program
    .command("update <id>")
    .description("Update a story")
    .option("--title <title>", "new title")
    .option("--stage <stage>", "move to this stage")
    .option(
      "--position <n>",
      "move to this place in the stage, from 1 (default: last when the stage changes)",
      parsePosition,
    )
    .option("--description <markdown>", "replace the description")
    .option("--field <key=value>", "set a custom field; an empty value clears it (repeatable)", collect)
    .action((id: string, opts: StoryOptions, command: Command) =>
      run(
        command,
        (ctx) =>
          updateStory(
            {
              id,
              title: opts.title,
              stage: opts.stage,
              position: opts.position,
              description: opts.description,
              fields: parseFieldFlags(opts.field),
            },
            ctx,
          ),
        (story) => `Updated ${story.id}`,
      ),
    );

  program
    .command("delete <id>")
    .description("Delete a story")
    .action((id: string, _opts: unknown, command: Command) =>
      run(
        command,
        (ctx) => deleteStory({ id }, ctx),
        (result) => `Deleted ${result.id}`,
      ),
    );

  program
    .command("get <id>")
    .description("Show a story")
    .action((id: string, _opts: unknown, command: Command) =>
      run(command, (ctx) => getStory({ id }, ctx), formatStory),
    );

  program
    .command("lock <id>")
    .description("Record that an agent works on a story in its current stage")
    .requiredOption("--agent <name>", "the name of the agent")
    .action((id: string, opts: { agent: string }, command: Command) =>
      run(
        command,
        (ctx) => lockStory({ id, agent: opts.agent }, ctx),
        (story) => `Locked ${story.id} for ${story.agentLock?.agent}`,
      ),
    );

  program
    .command("unlock <id>")
    .description("Remove the agent lock of a story")
    .option("--agent <name>", "refuse if a different agent holds the lock")
    .action((id: string, opts: { agent?: string }, command: Command) =>
      run(
        command,
        (ctx) => unlockStory({ id, agent: opts.agent }, ctx),
        (story) => `Unlocked ${story.id}`,
      ),
    );

  program
    .command("search [query]")
    .description("Find stories by text, stage or custom field values")
    .option("--stage <stage>", "only stories in this stage")
    .option("--field <key=value>", "only stories with this field value (repeatable)", collect)
    .action((query: string | undefined, opts: StoryOptions, command: Command) =>
      run(
        command,
        (ctx) => searchStories({ query, stage: opts.stage, fields: parseFieldFlags(opts.field) }, ctx),
        (stories) =>
          stories.length === 0
            ? "No stories found."
            : stories.map((story) => `${story.id.padEnd(8)} ${story.stage.padEnd(14)} ${story.title}`).join("\n"),
      ),
    );
}
