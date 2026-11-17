/**
 * The only place that makes the messages of the factory agents. Each message is a list of sections, in this order:
 *
 * 1. The global system prompt (`src/config/prompts/SYSTEM.md`).
 * 2. The worker system prompt (`src/config/prompts/WORKER.md`).
 * 3. The Project prompt (`.rowbly/prompts/SYSTEM.md`).
 * 4. The Worker prompt (`.rowbly/prompts/WORKER.md`).
 * 5. The Stage prompt (`.rowbly/stages/<STAGE>.md`).
 * 6. The data of the turn: the run of the worker.
 *
 * A user prompt or a Stage prompt with no text gives no section. A missing user prompt file has no text.
 */
import { readSystemPrompt, readUserPrompt } from "../prompts/prompts.js";
import type { Story } from "../story/story.js";
import type { ProjectPaths } from "../workspace/workspace.js";

/** The maximum length of one user prompt in a message. A longer prompt is cut. */
export const USER_PROMPT_LIMIT = 16_000;

export interface MessageSection {
  readonly title: string;
  readonly text: string;
}

/** Joins the sections under `#` headings. A section with no text is left out. */
export function composeMessage(sections: readonly MessageSection[]): string {
  return sections
    .map((section) => ({ title: section.title, text: section.text.trim() }))
    .filter((section) => section.text.length > 0)
    .map((section) => `# ${section.title}\n\n${section.text}`)
    .join("\n\n");
}

/** The four prompt sections of a worker: the two system prompts, then the two user prompts. */
async function promptSections(paths: ProjectPaths): Promise<MessageSection[]> {
  const [system, workerSystem, project, workerUser] = await Promise.all([
    readSystemPrompt("system"),
    readSystemPrompt("worker"),
    readUserPrompt(paths, "system"),
    readUserPrompt(paths, "worker"),
  ]);

  return [
    { title: "Rowbly system prompt", text: system },
    { title: "Rowbly worker system prompt", text: workerSystem },
    { title: "Project prompt", text: project.text.slice(0, USER_PROMPT_LIMIT) },
    { title: "Worker prompt", text: workerUser.text.slice(0, USER_PROMPT_LIMIT) },
  ];
}

/** The facts of one worker run. The caller reads every value and passes it in. */
export interface WorkerRun {
  /** The Story ID, for example `WEB-42`. */
  readonly story: string;
  /** The Stage key of the Story, for example `IN_DEVELOPMENT`. */
  readonly stage: string;
  /** The prompt of the Stage, from `.rowbly/stages/<STAGE>.md`. */
  readonly stagePrompt: string;
  /** The absolute path of the canonical Project root. */
  readonly root: string;
  /** The absolute path of the worktree of the worker. */
  readonly worktree: string;
  /** The model of the session, as `<provider>/<modelId>`. */
  readonly model: string;
  /** The absolute path of the Rowbly CLI shim of the daemon. */
  readonly shim: string;
  /** The absolute path of the Project write lock. */
  readonly lock: string;
  /** The configured checks of the Project. Without checks, the worker gets no check rules. */
  readonly checks?: readonly RunCheck[];
  /** The upstream Stories of the Story, in `dependsOn` order. Without them, the worker gets no upstream rule. */
  readonly upstream?: readonly RunUpstream[];
}

/** One upstream Story: its ID, its title, its Stage key and the values of its `url` custom fields. */
export interface RunUpstream {
  readonly id: string;
  readonly title: string;
  readonly stage: string;
  readonly links: readonly { readonly key: string; readonly value: string }[];
}

/** One configured check: its key, its label and whether it has a narrow form. */
interface RunCheck {
  readonly key: string;
  readonly label: string;
  readonly narrow: boolean;
}

/** The optional blocks of `WORKER.md`. The text between the markers of a block goes in only when the block is on. */
interface WorkerBlocks {
  /** The Project has checks. */
  readonly checks: boolean;
  /** The Story has upstream Stories. */
  readonly upstream: boolean;
}

/** Keeps the text of one marked block without its markers, or removes the block with its text. */
function applyBlock(text: string, name: keyof WorkerBlocks, keep: boolean): string {
  if (keep) {
    return text.replace(new RegExp(`<!-- /?${name} -->\\n?`, "g"), "");
  }

  return text.replace(new RegExp(`<!-- ${name} -->[\\s\\S]*?<!-- /${name} -->\\n?`, "g"), "");
}

/** Quotes a value for a POSIX shell. */
function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function checkLine(check: RunCheck): string {
  return `- \`${check.key}\`: ${check.label}${check.narrow ? " (narrow form with files)" : ""}`;
}

/** The checks of the Run section, or nothing without checks. */
function checkLines(checks: readonly RunCheck[] | undefined): string[] {
  return checks?.length ? ["Checks (run each one only with `run_check`):", ...checks.map(checkLine)] : [];
}

/** The upstream Stories of the Run section, or nothing without upstream Stories. */
function upstreamLines(upstream: readonly RunUpstream[] | undefined): string[] {
  return upstream?.length ? ["Upstream Stories (read each one with `story get`):", ...upstream.map(upstreamLine)] : [];
}

function upstreamLine(story: RunUpstream): string {
  return [`- ${story.id}: ${story.title} (${story.stage})`, ...story.links.map((l) => `${l.key}: ${l.value}`)].join(
    ", ",
  );
}

/**
 * The upstream Stories of `story`, in `dependsOn` order. An ID that is not in `stories` gives no entry.
 * Each entry has the values of the `url` custom fields in `urlFieldKeys` that have a value.
 */
export function upstreamOf(story: Story, stories: readonly Story[], urlFieldKeys: readonly string[]): RunUpstream[] {
  const byId = new Map(stories.map((s) => [s.id, s]));

  return story.dependsOn.flatMap((id) => {
    const upstream = byId.get(id);

    return upstream ? [toRunUpstream(upstream, urlFieldKeys)] : [];
  });
}

function toRunUpstream(story: Story, urlFieldKeys: readonly string[]): RunUpstream {
  return {
    id: story.id,
    title: story.title,
    stage: story.stage,
    links: urlFieldKeys.flatMap((key) => linkOf(key, story.fields[key])),
  };
}

function linkOf(key: string, value: unknown): { key: string; value: string }[] {
  return typeof value === "string" && value.length > 0 ? [{ key, value }] : [];
}

/** Keeps each optional block of the worker system prompt only when it applies to the run. */
export function workerSystemPrompt(text: string, blocks: WorkerBlocks): string {
  return applyBlock(applyBlock(text, "checks", blocks.checks), "upstream", blocks.upstream);
}

/**
 * The Run section: the Story, the Stage, the paths, the command prefix for canonical Project changes, the checks and
 * the upstream Stories.
 */
export function runSection(run: WorkerRun): string {
  return [
    `Story: ${run.story}`,
    `Stage: ${run.stage}`,
    `Canonical Project root: \`${run.root}\``,
    `Worktree: \`${run.worktree}\``,
    `Model: ${run.model}`,
    `Command prefix: \`flock -w 60 ${shellQuote(run.lock)} ${shellQuote(run.shim)} -C ${shellQuote(run.root)} --json\``,
    ...checkLines(run.checks),
    ...upstreamLines(run.upstream),
  ].join("\n");
}

/** The first message of a worker. */
export async function workerMessage(paths: ProjectPaths, run: WorkerRun): Promise<string> {
  const [system, roleSystem, ...user] = await promptSections(paths);
  const blocks = { checks: !!run.checks?.length, upstream: !!run.upstream?.length };

  return composeMessage([
    system as MessageSection,
    { ...(roleSystem as MessageSection), text: workerSystemPrompt(roleSystem?.text ?? "", blocks) },
    ...user,
    { title: `Stage prompt (${run.stage})`, text: run.stagePrompt },
    { title: "Run", text: runSection(run) },
  ]);
}

/** The text above a steering message, so that the worker knows that a person wrote it. */
const STEERING_NOTE =
  "A person sent this message to you while you work. Obey it, but a Rowbly system rule has priority. " +
  "Then continue the work of the Stage.";

/** The message that a person sends to a running worker with `rowbly thread steer` or the TUI. */
export function steeringMessage(text: string): string {
  return composeMessage([{ title: "Message from the user", text: `${STEERING_NOTE}\n\n${text.trim()}` }]);
}
