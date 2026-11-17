import {
  type Dispatch,
  type RefObject,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { type FactoryStatus, getFactoryStatus, sameFactoryStatus } from "../../../services/factory/factory.js";
import { type FactoryActivity, getFactoryActivity } from "../../../services/factory-activity/factory-activity.js";
import { recordProject } from "../../../services/known-project/known-project.js";
import { getProject } from "../../../services/project/project.js";
import { listStages } from "../../../services/stage/stage.js";
import { type Story, searchStories, withoutStory, withStory } from "../../../services/story/story.js";
import {
  copyNotice,
  renumberNotice,
  repairDuplicateStoryIds,
} from "../../../services/story-renumber/story-renumber.js";
import { hasProject, type ServiceContext } from "../../../services/workspace/workspace.js";
import {
  type AsyncState,
  showToast,
  type ToastStore,
  useAsync,
  useFactoryChanges,
  useFactoryStateChanges,
  useStoryChanges,
  useToast,
} from "../../hooks/index.js";
import { useLatest, writeRef } from "../../hooks/refs.js";
import type { Board } from "./shell-state.js";
import { usePiPreload } from "./use-pi-preload.js";

/** The data of the shell: the board of the Project, and the status of its factory. */
export interface ShellData {
  /** `null` when the directory has no Project. */
  readonly data: AsyncState<Board | null>;
  readonly factory: AsyncState<FactoryStatus | undefined>;
  /** Reads the board again. */
  readonly reload: () => void;
  /** Puts a Story that a write returned on the board in memory, at the top of its Stage. It reads no file. */
  readonly putOnBoard: (story: Story) => void;
  /** Removes the Story `id` from the board in memory. It reads no file. */
  readonly takeFromBoard: (id: string) => void;
}

/** A board that a Story action changed in memory, and the board that it changed. */
interface LocalBoard {
  readonly base: Board;
  readonly board: Board;
}

/**
 * Removes the old copies of each Story, then gives the newer Story of each duplicate Story ID a new number. It shows
 * a notice for each change. A failure shows an error, and the board still loads. It runs only on the first load of
 * the board for a `ctx`. A duplicate ID that a different process makes later is repaired at the next start or Project
 * switch, and `rowbly doctor` reports it.
 */
async function repairDuplicates(ctx: ServiceContext, toast: ToastStore): Promise<void> {
  try {
    const { removed, changes } = await repairDuplicateStoryIds(ctx);

    for (const removal of removed) {
      showToast(toast, "info", copyNotice(removal));
    }

    for (const change of changes) {
      showToast(toast, "info", renumberNotice(change));
    }
  } catch (error) {
    toast.error(error);
  }
}

/**
 * Reads the board. No project is a state of the screen, not a failure. A project in a parent directory does not open.
 * The repair of duplicate Story IDs runs only when `repaired` does not hold `ctx`: on the first load after the start,
 * after a Project switch, or after the onboarding creates the Project. A reload of the same `ctx` does not repair.
 */
async function loadBoard(
  ctx: ServiceContext,
  toast: ToastStore,
  repaired: RefObject<ServiceContext | undefined>,
): Promise<Board | null> {
  if (!(await hasProject(ctx))) {
    return null;
  }

  if (repaired.current !== ctx) {
    writeRef(repaired, ctx);
    await repairDuplicates(ctx, toast);
  }

  const [project, stages, stories] = await Promise.all([getProject(ctx), listStages(ctx), searchStories({}, ctx)]);
  // A problem with the factory state file is a status, not a failure, so the Stories still load.
  const activity = await getFactoryActivity({ stories }, ctx);

  return { project, stages, stories, activity };
}

/** The factory activity that Rowbly read again after a change of the state file, and the Stories that it is for. */
interface LiveActivity {
  readonly stories: Story[];
  readonly activity: FactoryActivity;
}

/**
 * Reads only the factory state file again, for the Stories that are on the board. It does not read the Stories,
 * the Stages or the config.
 */
async function loadActivity(ctx: ServiceContext, board: Board | null | undefined): Promise<LiveActivity | undefined> {
  if (!board) {
    return undefined;
  }

  return { stories: board.stories, activity: await getFactoryActivity({ stories: board.stories }, ctx) };
}

/**
 * Gives the board with the newest activity. An activity that Rowbly read for older Stories does not apply, because
 * the load of the new Stories also read the state file. An activity for the `base` board that a Story action changed
 * applies, because the activity is by Story ID.
 */
function withActivity(
  board: Board | null | undefined,
  base: Board | null | undefined,
  live: LiveActivity | undefined,
): Board | null | undefined {
  if (!(board && live) || (live.stories !== board.stories && live.stories !== base?.stories)) {
    return board;
  }

  return { ...board, activity: live.activity };
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

/** The board that shows: the board that a Story action changed, while no read replaced the board that it changed. */
function shownBoard(local: LocalBoard | undefined, base: Board | null | undefined): Board | null | undefined {
  return local && local.base === base ? local.board : base;
}

/**
 * Changes the board that shows with `change`. A second change before the next read changes the result of the first.
 * No board gives no change.
 */
function patchBoard(
  local: LocalBoard | undefined,
  base: Board | null | undefined,
  change: (board: Board) => Board,
): LocalBoard | undefined {
  const board = shownBoard(local, base);

  return base && board ? { base, board: change(board) } : local;
}

function boardWithStory(board: Board, story: Story): Board {
  return { ...board, stories: withStory(board.stories, board.stages, story) };
}

function boardWithoutStory(board: Board, id: string): Board {
  return { ...board, stories: withoutStory(board.stories, id) };
}

/** True when the board shows a Project: it has loaded, with no error, and the directory has a Project. */
function showsProject(data: AsyncState<Board | null>): boolean {
  return !data.loading && data.error === undefined && Boolean(data.data);
}

/**
 * Loads the board of the Project in `ctx`, and reads it again when a different process changes it. `preloadPi`, when
 * given, imports the Pi SDK one time a short time after the board first shows.
 */
export function useShellData(ctx: ServiceContext, preloadPi?: () => Promise<void>): ShellData {
  const toast = useToast();
  const [version, setVersion] = useState(0);
  const repaired = useRef<ServiceContext | undefined>(undefined);
  const data = useAsync(() => loadBoard(ctx, toast, repaired), [ctx, version]);
  // A Story action changes the board in memory. The next read (the watcher echo of the write) replaces the change.
  const [local, setLocal] = useState<LocalBoard>();
  const base = useLatest(data.data);
  const projectRoot = data.data?.project.root;
  const projectName = data.data?.project.projectName;

  // A change of the state file reads only the activity again. The first run has no board, so it reads nothing.
  const activity = useAsync(() => loadActivity(ctx, data.data), []);

  // Agents change Stories from other processes.
  useStoryChanges(projectRoot, data.refresh);
  // The factory writes its state file frequently.
  useFactoryStateChanges(projectRoot, activity.refresh);

  // A poll that reads the same status changes no state, so the shell does not render again.
  const factory = useAsync(() => loadFactoryStatus(ctx, projectRoot), [projectRoot], { isEqual: sameFactoryStatus });

  useFactoryChanges(projectRoot, factory.refresh);
  // biome-ignore lint/correctness/useExhaustiveDependencies: record only when another Project opens or the name changes.
  useEffect(() => {
    recordOpenProject(ctx, projectRoot, projectName, toast);
  }, [projectRoot, projectName]);

  usePiPreload(showsProject(data), preloadPi);

  // The same board and the same data while the board and the activity do not change, so the memo children skip a render.
  const loaded = shownBoard(local, data.data);
  const board = useMemo(() => withActivity(loaded, data.data, activity.data), [loaded, data.data, activity.data]);
  const shown = useMemo(() => ({ ...data, data: board }), [data, board]);
  const reload = useCallback(() => bump(setVersion), []);
  const putOnBoard = useCallback(
    (story: Story) => setLocal((prev) => patchBoard(prev, base.current, (b) => boardWithStory(b, story))),
    [base],
  );
  const takeFromBoard = useCallback(
    (id: string) => setLocal((prev) => patchBoard(prev, base.current, (b) => boardWithoutStory(b, id))),
    [base],
  );

  return { data: shown, factory, reload, putOnBoard, takeFromBoard };
}
