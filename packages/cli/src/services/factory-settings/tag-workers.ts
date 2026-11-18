import { readConfig } from "../config/config.js";
import { ValidationError } from "../errors/errors.js";
import { checkedTags } from "../story/story-tags.js";
import { findProject, type ServiceContext } from "../workspace/workspace.js";
import type { FactorySettings, ModelChoice } from "./factory-settings.js";
import { withKey } from "./worker-overrides.js";

/** The configure flags of a tag rule. */
export interface TagWorkerInput {
  readonly tag?: string;
  readonly stage?: string;
  readonly story?: string;
  readonly worker?: string;
  readonly workerThinking?: ModelChoice["thinkingLevel"];
  readonly clearWorker?: boolean;
}

/** The configure keys that a tag rule can use. */
const TAG_KEYS: readonly string[] = ["tag", "worker", "workerThinking", "clearWorker"];

/** Tells if the configure flags select a tag rule. */
export function hasTagInput(input: TagWorkerInput): boolean {
  return input.tag !== undefined;
}

/** Gives the first rule that the flags of a tag rule break, or undefined. */
export function tagWorkerProblem(input: TagWorkerInput): string | undefined {
  if (input.stage !== undefined || input.story !== undefined) {
    return "A tag rule applies in all Stages. Do not select a Stage or a Story";
  }

  const others = Object.entries(input).filter(([key, value]) => !TAG_KEYS.includes(key) && value !== undefined);

  if (others.length) {
    return "A tag rule sets only the worker model";
  }

  if (input.clearWorker && (input.worker !== undefined || input.workerThinking !== undefined)) {
    return "Do not select a worker model when you clear it";
  }

  return !input.clearWorker && input.worker === undefined ? "Select the worker model or clear it" : undefined;
}

/**
 * Gives the tag value without spaces at the ends. A new rule must name a tag of the Project. A clear does not check
 * the tag, so that the user can remove the rule of a tag that the Project does not have now.
 */
export async function checkedTagKey(tag: string, clear: boolean, ctx: ServiceContext): Promise<string> {
  const value = tag.trim();

  if (!value) {
    throw new ValidationError("Select a tag");
  }

  if (clear) {
    return value;
  }

  const config = await readConfig(await findProject(ctx));

  return checkedTags(config, [value], ["tag"])[0] as string;
}

/** Tells if the settings have a rule for the tag. */
export function hasTagWorker(settings: FactorySettings, tag: string): boolean {
  return settings.tagWorkerModels?.[tag] !== undefined;
}

/** Gives the tag rules with the rule of the tag set to the choice, or removed without a choice. */
export function withTagWorker(
  settings: FactorySettings,
  tag: string,
  choice: ModelChoice | undefined,
): Pick<FactorySettings, "tagWorkerModels"> {
  return { tagWorkerModels: withKey(settings.tagWorkerModels, tag, choice) };
}
