import { readConfig, type StageConfig } from "../config/config.js";
import { type FactoryStatus, getFactoryStatus } from "../factory/factory.js";
import { readStoryFiles, type StoryFile } from "../story-files/story-files.js";
import { listThreads } from "../thread/thread-list.js";
import type { ThreadRecord } from "../thread/thread-types.js";
import { type LostConnection, liveHosts, lostConnections } from "../thread-connection/thread-connection.js";
import { findProject, type ServiceContext } from "../workspace/workspace.js";

export interface StageSummary {
  readonly key: string;
  readonly label: string;
  readonly enabled: boolean;
  readonly stories: number;
}

/** A short summary of a Project for a person: the factory phase, the Thread counts and the Story counts. */
export interface ProjectStatus {
  readonly factory: { readonly phase: FactoryStatus["phase"] };
  readonly threads: { readonly running: number; readonly pending: number };
  /** The Stages in config order. */
  readonly stages: readonly StageSummary[];
  /** All Stories, also the Stories whose Stage is not in the config. */
  readonly stories: number;
  /** The remote Threads whose worker host lost its connection. The list is absent when no Thread lost it. */
  readonly connectionLost?: readonly LostConnection[];
}

function storyStage(file: StoryFile): unknown {
  return file.doc.data.stage;
}

function stageSummary(stage: StageConfig, files: readonly StoryFile[]): StageSummary {
  const stories = files.filter((file) => storyStage(file) === stage.key).length;

  return { key: stage.key, label: stage.label, enabled: stage.enabled, stories };
}

function countStatus(threads: readonly ThreadRecord[], status: ThreadRecord["status"]): number {
  return threads.filter((thread) => thread.status === status).length;
}

/** Collects the summary. A factory runtime problem gives the phase `unavailable`, not an error. */
export async function getProjectStatus(ctx: ServiceContext = {}): Promise<ProjectStatus> {
  const paths = await findProject(ctx);
  const config = await readConfig(paths);
  const files = await readStoryFiles(paths);
  const { threads } = await listThreads({}, ctx);
  const factory = await getFactoryStatus(ctx);
  const lost = lostConnections(threads, liveHosts(factory), Date.now());

  return {
    factory: { phase: factory.phase },
    threads: { running: countStatus(threads, "running"), pending: countStatus(threads, "pending") },
    stages: config.stages.map((stage) => stageSummary(stage, files)),
    stories: files.length,
    ...(lost.length ? { connectionLost: lost } : {}),
  };
}
