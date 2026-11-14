/**
 * The only place that makes the messages of the factory agents. Each message is a list of sections, in this order:
 *
 * 1. The global system prompt (`src/config/prompts/SYSTEM.md`).
 * 2. The system prompt of the role (`SUPERVISOR.md` or `WORKER.md`).
 * 3. The Project prompt (`.rowbly/prompts/SYSTEM.md`).
 * 4. The user prompt of the role (`.rowbly/prompts/SUPERVISOR.md` or `WORKER.md`).
 * 5. Workers only: the Stage prompt (`.rowbly/stages/<STAGE>.md`).
 * 6. The data of the turn: the digest of the supervisor, or the run of the worker.
 *
 * A user prompt or a Stage prompt with no text gives no section. A missing user prompt file has no text.
 */
import { type PromptName, readSystemPrompt, readUserPrompt } from "../prompts/prompts.js";
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

/** The four prompt sections of a role: the two system prompts, then the two user prompts. */
async function promptSections(paths: ProjectPaths, role: Exclude<PromptName, "system">): Promise<MessageSection[]> {
  const label = role === "supervisor" ? "Supervisor" : "Worker";
  const [system, roleSystem, project, roleUser] = await Promise.all([
    readSystemPrompt("system"),
    readSystemPrompt(role),
    readUserPrompt(paths, "system"),
    readUserPrompt(paths, role),
  ]);

  return [
    { title: "Rowbly system prompt", text: system },
    { title: `Rowbly ${role} system prompt`, text: roleSystem },
    { title: "Project prompt", text: project.text.slice(0, USER_PROMPT_LIMIT) },
    { title: `${label} prompt`, text: roleUser.text.slice(0, USER_PROMPT_LIMIT) },
  ];
}

/** The message that the manager sends to the supervisor on each wake. */
export async function supervisorMessage(paths: ProjectPaths, digest: string): Promise<string> {
  return composeMessage([...(await promptSections(paths, "supervisor")), { title: "Digest", text: digest }]);
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
}

/** One configured check: its key, its label and whether it has a narrow form. */
export interface RunCheck {
  readonly key: string;
  readonly label: string;
  readonly narrow: boolean;
}

/** The text between these markers of `WORKER.md` goes in only when the Project has checks. */
const CHECKS_MARKER = /<!-- \/?checks -->\n?/g;
const CHECKS_BLOCK = /<!-- checks -->[\s\S]*?<!-- \/checks -->\n?/g;

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

/** Keeps the check rules of the worker system prompt only when the Project has checks. */
export function workerSystemPrompt(text: string, hasChecks: boolean): string {
  if (!hasChecks) {
    return text.replace(CHECKS_BLOCK, "");
  }

  return text.replace(CHECKS_MARKER, "");
}

/** The Run section: the Story, the Stage, the paths, the command prefix for canonical Project changes and the checks. */
export function runSection(run: WorkerRun): string {
  return [
    `Story: ${run.story}`,
    `Stage: ${run.stage}`,
    `Canonical Project root: \`${run.root}\``,
    `Worktree: \`${run.worktree}\``,
    `Model: ${run.model}`,
    `Command prefix: \`flock -w 60 ${shellQuote(run.lock)} ${shellQuote(run.shim)} -C ${shellQuote(run.root)} --json\``,
    ...checkLines(run.checks),
  ].join("\n");
}

/** The first message of a worker. */
export async function workerMessage(paths: ProjectPaths, run: WorkerRun): Promise<string> {
  const [system, roleSystem, ...user] = await promptSections(paths, "worker");
  const hasChecks = !!run.checks?.length;

  return composeMessage([
    system as MessageSection,
    { ...(roleSystem as MessageSection), text: workerSystemPrompt(roleSystem?.text ?? "", hasChecks) },
    ...user,
    { title: `Stage prompt (${run.stage})`, text: run.stagePrompt },
    { title: "Run", text: runSection(run) },
  ]);
}
