import { type Dispatch, type SetStateAction, useEffect, useState } from "react";
import { type FactoryStatus, getFactoryStatus } from "../../../services/factory/factory.js";
import { getFactoryActivity } from "../../../services/factory-activity/factory-activity.js";
import { recordProject } from "../../../services/known-project/known-project.js";
import { getProject } from "../../../services/project/project.js";
import { listStages } from "../../../services/stage/stage.js";
import { searchStories } from "../../../services/story/story.js";
import { hasProject, type ServiceContext } from "../../../services/workspace/workspace.js";
import {
  type AsyncState,
  type ToastStore,
  useAsync,
  useFactoryChanges,
  useStoryChanges,
  useToast,
} from "../../hooks/index.js";
import type { Board } from "./shell-state.js";

/** The data of the shell: the board of the Project, and the status of its factory. */
export interface ShellData {
  /** `null` when the directory has no Project. */
  readonly data: AsyncState<Board | null>;
  readonly factory: AsyncState<FactoryStatus | undefined>;
  /** Reads the board again. */
  readonly reload: () => void;
}

/** Reads the board. No project is a state of the screen, not a failure. A project in a parent directory does not open. */
async function loadBoard(ctx: ServiceContext): Promise<Board | null> {
  if (!(await hasProject(ctx))) {
    return null;
  }

  const [project, stages, stories] = await Promise.all([getProject(ctx), listStages(ctx), searchStories({}, ctx)]);
  // A problem with the factory state file is a status, not a failure, so the Stories still load.
  const activity = await getFactoryActivity({ stories }, ctx);

  return { project, stages, stories, activity };
}

function unavailable(error: unknown): FactoryStatus {
  return {
    version: 1,
    phase: "unavailable",
    error: error instanceof Error ? error.message : "Factory status is unavailable",
  };
}

/** The factory is a status, not a part of the board: a problem with it never stops the board. */
async function loadFactoryStatus(ctx: ServiceContext, root: string | undefined): Promise<FactoryStatus | undefined> {
  return root === undefined ? undefined : getFactoryStatus({ ...ctx, cwd: root }).catch(unavailable);
}

/** Records the Project that opens in `~/.rowblyrc.json`, for the Project switcher. */
function recordOpenProject(
  ctx: ServiceContext,
  root: string | undefined,
  name: string | undefined,
  toast: ToastStore,
): void {
  if (root === undefined || name === undefined) {
    return;
  }

  recordProject({ path: root, name }, ctx).catch((err: unknown) => toast.error(err));
}

function bump(setVersion: Dispatch<SetStateAction<number>>): void {
  setVersion((v) => v + 1);
}

/** Loads the board of the Project in `ctx`, and reads it again when a different process changes it. */
export function useShellData(ctx: ServiceContext): ShellData {
  const toast = useToast();
  const [version, setVersion] = useState(0);
  const data = useAsync(() => loadBoard(ctx), [ctx, version]);
  const projectRoot = data.data?.project.root;
  const projectName = data.data?.project.projectName;

  // Agents change Stories from other processes.
  useStoryChanges(projectRoot, data.refresh);

  const factory = useAsync(() => loadFactoryStatus(ctx, projectRoot), [projectRoot]);

  useFactoryChanges(projectRoot, factory.refresh);
  // biome-ignore lint/correctness/useExhaustiveDependencies: record only when another Project opens or the name changes.
  useEffect(() => recordOpenProject(ctx, projectRoot, projectName, toast), [projectRoot, projectName]);

  return { data, factory, reload: () => bump(setVersion) };
}
