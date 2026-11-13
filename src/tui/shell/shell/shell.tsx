import { Box, type BoxProps, Text, useApp, useInput } from "ink";
import { useContext, useEffect, useState } from "react";
import { type FactoryLaunch, type FactoryStatus, getFactoryStatus } from "../../../services/factory/factory.js";
import { getFactoryActivity } from "../../../services/factory-activity/factory-activity.js";
import { recordProject } from "../../../services/known-project/known-project.js";
import { getProject } from "../../../services/project/project.js";
import { listStages, type Stage, updateStage } from "../../../services/stage/stage.js";
import { deleteStory, type Story, searchStories, updateStory } from "../../../services/story/story.js";
import { hasProject, type ServiceContext } from "../../../services/workspace/workspace.js";
import {
  ConfirmDialog,
  FOOTER_HEIGHT,
  Footer,
  HEADER_HEIGHT,
  Loading,
  MAIN_MIN_WIDTH,
  Panel,
  SIDEBAR_CHROME_HEIGHT,
  SIDEBAR_MIN_WIDTH,
  SIDEBAR_WIDTH,
  Sidebar,
  STACKED_BELOW_WIDTH,
  STACKED_MIN_HEIGHT,
  ToastArea,
} from "../../components/index.js";
import {
  ActiveContext,
  LayoutContext,
  ShellContext,
  useAsync,
  useFactoryChanges,
  useIsActive,
  useLayout,
  useStoryChanges,
  useToast,
} from "../../hooks/index.js";
import { groupDelta, type KeyHint, moveDelta, reorderDelta } from "../../keymap.js";
import { FactoryModal } from "../../screens/factory/index.js";
import { Onboarding } from "../../screens/onboarding/index.js";
import { SettingsModal } from "../../screens/settings/index.js";
import { StageFormModal } from "../../screens/stages/index.js";
import {
  deleteStoryMessage,
  EditStoryModal,
  FactoryStatusLine,
  NewStoryModal,
  rowStage,
  StoryList,
  stageRowId,
  storyListRows,
} from "../../screens/stories/index.js";
import { theme } from "../../theme.js";
import { Header } from "../header/index.js";
import { HelpModal } from "../help-modal/index.js";
import { ProjectSwitcher } from "../project-switcher/index.js";
import { StoryFinder } from "../story-finder/index.js";

/** The id of the first sidebar entry, which shows the Stories of every Stage. */
const ALL_STAGES = "*";

/** The project in the directory where Rowbly runs. */
const CWD: ServiceContext = {};

type Overlay =
  | { kind: "finder" }
  | { kind: "projects" }
  | { kind: "help" }
  | { kind: "settings"; section?: string }
  | { kind: "newStory" }
  | { kind: "editStory"; story: Story }
  | { kind: "deleteStory"; story: Story }
  | { kind: "newStage" }
  | { kind: "editStage"; stage: Stage }
  | { kind: "factory" };

/** The region that takes `↑/↓`, `n` and the other keys of a list: the Stage sidebar or the Story list. */
type Pane = "stages" | "stories";

/**
 * The frame of the app: the header with the Story finder and **+ New Story**, the Stage sidebar, the
 * Story list and the footer. The sidebar filters the list by Stage. Drag its right edge to change its
 * width, and press `ctrl+b` to hide or show it. In a narrow terminal, the sidebar goes above the list. With All Stages, the list has one section for each Stage:
 * `enter` or a click on a selected heading expands or collapses it, and `←/→` collapse and expand. `enter`
 * or a click on a Story opens it for editing, and so does a pick in the Story finder. `shift+↑/↓` moves the
 * selected Story up or down its Stage, and past either end into the next Stage. `ctrl+shift+↑/↓` moves it
 * to the previous or next Stage. A drag of a Story to another row moves it there. `d` asks before it
 * deletes the selected Story. The Modals that create and edit records open over the Story list. The Project
 * Button and `p` open the Project switcher, and each Project that opens is recorded in `~/.rowblyrc.json`.
 * Without a Project in the directory where Rowbly runs, the Story panel shows the onboarding steps, which create one
 * there. A Project in a parent directory does not open. The Factory Button and `f` open the Factory controls. The
 * header shows the state of the factory, which runs in a process of its own and continues after Rowbly quits.
 */
export function Shell({
  ctx: initialCtx = CWD,
  launch,
}: {
  ctx?: ServiceContext;
  /** How the Factory controls start the factory process. The CLI entry point supplies it. */
  launch?: FactoryLaunch;
}) {
  const { exit } = useApp();
  // The Project switcher changes where the services look.
  const [ctx, setCtx] = useState(initialCtx);
  const active = useIsActive();
  const registry = useContext(ShellContext);
  const layout = useLayout();
  const [version, setVersion] = useState(0);
  const reload = () => setVersion((v) => v + 1);
  const data = useAsync(async () => {
    // No project is a state of the screen, not a failure. A project in a parent directory does not open.
    if (!(await hasProject(ctx))) {
      return null;
    }
    const [project, stages, stories] = await Promise.all([getProject(ctx), listStages(ctx), searchStories({}, ctx)]);
    // A problem with the factory state file is a status, not a failure, so the Stories still load.
    const activity = await getFactoryActivity({ stories }, ctx);
    return { project, stages, stories, activity };
  }, [ctx, version]);
  const board = data.data ?? undefined;
  const noProject = !data.loading && data.data === null;
  const stages = board?.stages ?? [];
  const stories = board?.stories ?? [];
  const projectRoot = board?.project.root;
  const projectName = board?.project.projectName;
  // Agents change Stories from other processes.
  useStoryChanges(projectRoot, data.refresh);
  // The factory is a status, not a part of the board: a problem with it never stops the board.
  const factory = useAsync(
    async (): Promise<FactoryStatus | undefined> =>
      projectRoot === undefined
        ? undefined
        : getFactoryStatus({ ...ctx, cwd: projectRoot }).catch((error: unknown) => ({
            version: 1,
            phase: "unavailable" as const,
            error: error instanceof Error ? error.message : "Factory status is unavailable",
          })),
    [projectRoot],
  );
  useFactoryChanges(projectRoot, factory.refresh);

  const [overlay, setOverlay] = useState<Overlay | null>(null);
  const [onboardingHints, setOnboardingHints] = useState<readonly KeyHint[]>([]);
  const [pane, setPane] = useState<Pane>("stories");
  // Dragged with the mouse and toggled with `ctrl+b`; both last until Rowbly quits.
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_WIDTH);
  const [sidebarShown, setSidebarShown] = useState(true);
  const [stageKey, setStageKey] = useState<string | null>(null);
  // The id of the selected row: a Story id, or the `stageRowId` of a section heading.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // The Stage sections that are collapsed in All Stages; they last until Rowbly quits.
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());

  // A Stage that is gone (for example, deleted from the CLI) shows every Story again.
  const stage = stages.find((s) => s.key === stageKey);
  const visible = stage ? stories.filter((story) => story.stage === stage.key) : stories;
  const rows = storyListRows(stages, visible, stage ? undefined : collapsed);
  const selectedAt = rows.findIndex((row) => row.id === selectedId);
  // Without a selection, the cursor starts on the first Story, not on a heading.
  const cursor = Math.max(0, selectedAt >= 0 ? selectedAt : rows.findIndex((row) => row.kind === "story"));
  const row = rows[cursor];
  const selectStory = (index: number) => setSelectedId(rows[index]?.id ?? null);
  const fold = (key: string, folded: boolean) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (folded) {
        next.add(key);
      } else {
        next.delete(key);
      }
      return next;
    });
  /** Shows the Story `story` in the list: it leaves a Stage filter that hides it and expands its section. */
  const reveal = (story: Story) => {
    if (stageKey !== null && story.stage !== stageKey) {
      setStageKey(null);
    }
    fold(story.stage, false);
    setSelectedId(story.id);
  };
  /** Opens the Story at `index` for editing, or expands or collapses the section of the heading at `index`. */
  const activateRow = (index: number) => {
    const at = rows[index];
    setSelectedId(at?.id ?? null);
    if (at?.kind === "stage") {
      fold(at.key, !at.collapsed);
    } else if (at?.kind === "story") {
      setOverlay({ kind: "editStory", story: at.story });
    }
  };
  // `n` creates the Story in the Stage of the selected row when the list shows every Stage.
  const cursorStage = stages.find((s) => s.key === (stage?.key ?? rowStage(row)))?.key;
  const stageIndex = stage ? stages.indexOf(stage) + 1 : 0;
  const selectStage = (index: number) => setStageKey(stages[index - 1]?.key ?? null);

  const idle = active && overlay === null;
  const sidebar = board !== undefined && sidebarShown;
  const sidebarFocused = idle && sidebar && pane === "stages";
  const listFocused = idle && !sidebarFocused;

  const toggleSidebar = () => {
    if (sidebarShown) {
      setPane("stories");
    }
    setSidebarShown(!sidebarShown);
  };
  const editStage = () => {
    if (stage) {
      setOverlay({ kind: "editStage", stage });
    }
  };
  const toast = useToast();
  const close = () => setOverlay(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: record only when another Project opens or the name changes.
  useEffect(() => {
    if (projectRoot === undefined || projectName === undefined) {
      return;
    }
    recordProject({ path: projectRoot, name: projectName }, ctx).catch((err: unknown) => toast.error(err));
  }, [projectRoot, projectName]);
  /** Opens the Project at `path`, with no filter or selection from the Project that was open. */
  const switchProject = (path: string) => {
    close();
    if (path === projectRoot) {
      return;
    }
    setCtx({ ...ctx, cwd: path });
    setStageKey(null);
    setSelectedId(null);
    setCollapsed(new Set());
    setPane("stories");
  };
  /** Moves the Stage `key` to the 1-based `position` in board order. The selection stays on the Stage. */
  const moveStage = (key: string, position: number) => {
    const from = stages.findIndex((s) => s.key === key) + 1;
    const to = Math.max(1, Math.min(stages.length, position));
    if (from === 0 || from === to) {
      return;
    }
    updateStage({ key, position: to }, ctx).then(reload, (err: unknown) => toast.error(err));
  };

  /** Puts the Story `story` at the 1-based `position` in the Stage `key`. The selection stays on the Story. */
  const placeStory = (story: Story, key: string, position: number) => {
    if (key === story.stage && position === story.position) {
      return;
    }
    updateStory({ id: story.id, stage: key, position }, ctx).then(
      (moved) => {
        // A Stage filter follows the Story to its new Stage.
        if (stageKey !== null) {
          setStageKey(moved.stage);
        }
        fold(moved.stage, false);
        setSelectedId(moved.id);
        reload();
      },
      (err: unknown) => toast.error(err),
    );
  };
  /**
   * Moves the Story `story` `delta` Stages along the board order: to the top of the next Stage, or to the
   * bottom of the previous Stage.
   */
  const moveStoryStage = (story: Story, delta: -1 | 1) => {
    const to = stages[stages.findIndex((s) => s.key === story.stage) + delta];
    if (!to) {
      return;
    }
    placeStory(story, to.key, delta > 0 ? 1 : stories.filter((s) => s.stage === to.key).length + 1);
  };
  /** Moves the Story `story` one place up or down in its Stage, and past the end into the next Stage. */
  const shiftStory = (story: Story, delta: -1 | 1) => {
    const count = stories.filter((s) => s.stage === story.stage).length;
    const position = story.position + delta;
    if (position >= 1 && position <= count) {
      placeStory(story, story.stage, position);
    } else {
      moveStoryStage(story, delta);
    }
  };
  /**
   * The Story `id` was dropped in the gap before the row at `gap`. It goes below the Story above the gap, or
   * to the top of the Stage whose heading is above the gap.
   */
  const dropStory = (id: string, gap: number) => {
    const story = stories.find((s) => s.id === id);
    const above = rows
      .slice(0, gap)
      .filter((r) => r.id !== id)
      .at(-1);
    setPane("stories");
    if (!story) {
      return;
    }
    if (!above) {
      placeStory(story, stage?.key ?? story.stage, 1);
    } else if (above.kind === "stage") {
      placeStory(story, above.key, 1);
    } else {
      const peers = stories.filter((s) => s.stage === above.story.stage && s.id !== id);
      placeStory(story, above.story.stage, peers.indexOf(above.story) + 2);
    }
  };

  /** After the Story `id` is deleted, selects the row below it (or above it, at the end of the list). */
  const afterDelete = (id: string) => {
    const at = rows.findIndex((r) => r.id === id);
    const next = rows[at + 1] ?? rows[at - 1];
    setSelectedId(at >= 0 && next ? next.id : null);
    close();
    reload();
  };
  const removeStory = (story: Story) => {
    deleteStory({ id: story.id }, ctx).then(
      ({ id }) => {
        toast.push("info", `Deleted ${id}`);
        afterDelete(id);
      },
      (err: unknown) => {
        toast.error(err);
        close();
      },
    );
  };

  useInput(
    (input, key) => {
      // The onboarding steps have no overlay around their text fields.
      if (noProject && registry.captured().text) {
        return;
      }
      if (key.ctrl && input === "b") {
        return toggleSidebar();
      }
      if (key.ctrl && input === "p" && board) {
        return setOverlay({ kind: "finder" });
      }
      const group = groupDelta(key);
      if (group && board && listFocused && row?.kind === "story") {
        return moveStoryStage(row.story, group);
      }
      if (key.ctrl || key.meta) {
        return;
      }
      if (input === "q") {
        return exit();
      }
      if (input === "?") {
        return setOverlay({ kind: "help" });
      }
      if (input === "p") {
        return setOverlay({ kind: "projects" });
      }
      if (!board) {
        return;
      }
      if (input === ",") {
        return setOverlay({ kind: "settings" });
      }
      if (input === "f") {
        return setOverlay({ kind: "factory" });
      }
      if (key.tab && sidebar) {
        return setPane(sidebarFocused ? "stories" : "stages");
      }
      if (key.escape && sidebarFocused) {
        return setPane("stories");
      }
      if (input === "[" || input === "]") {
        return selectStage((stageIndex + (input === "[" ? -1 : 1) + stages.length + 1) % (stages.length + 1));
      }
      const delta = moveDelta(input, key);
      const shift = reorderDelta(input, key);
      if (sidebarFocused) {
        if (shift && stage) {
          moveStage(stage.key, stageIndex + shift);
        } else if (delta) {
          selectStage(Math.max(0, Math.min(stages.length, stageIndex + delta)));
        } else if (input === "n") {
          setOverlay({ kind: "newStage" });
        } else if (input === "e") {
          editStage();
        }
      } else if (shift) {
        if (row?.kind === "story") {
          shiftStory(row.story, shift);
        }
      } else if (delta) {
        selectStory(Math.max(0, Math.min(rows.length - 1, cursor + delta)));
      } else if (input === "n") {
        setOverlay({ kind: "newStory" });
      } else if (row?.kind === "stage" && (key.return || input === " ")) {
        fold(row.key, !row.collapsed);
      } else if (row?.kind === "story" && key.return) {
        setOverlay({ kind: "editStory", story: row.story });
      } else if (row?.kind === "story" && input === "d") {
        setOverlay({ kind: "deleteStory", story: row.story });
      } else if (row?.kind === "stage" && (key.leftArrow || key.rightArrow)) {
        fold(row.key, key.leftArrow);
      } else if (row?.kind === "story" && key.leftArrow && !stage) {
        // `←` on a Story collapses its section and selects the heading.
        fold(row.story.stage, true);
        setSelectedId(stageRowId(row.story.stage));
      }
    },
    { isActive: idle },
  );

  const hints: KeyHint[] = !board
    ? [...(noProject ? onboardingHints : []), { key: "p", description: "switch Project", secondary: noProject }]
    : sidebarFocused
      ? [
          { key: "↑/↓", description: "select Stage" },
          { key: "n", description: "new Stage" },
          ...(stage
            ? [
                { key: "e", description: "edit Stage" },
                { key: "shift+↑/↓", description: "move Stage" },
              ]
            : []),
          { key: "tab", description: "Stories" },
          { key: "ctrl+b", description: "hide Stages" },
          { key: "p", description: "switch Project", secondary: true },
        ]
      : [
          { key: "↑/↓", description: "select" },
          ...(row?.kind === "stage" ? [{ key: "enter", description: row.collapsed ? "expand" : "collapse" }] : []),
          ...(row?.kind === "story"
            ? [
                { key: "enter", description: "edit Story" },
                { key: "shift+↑/↓", description: "move Story" },
                { key: "ctrl+shift+↑/↓", description: "change Stage", secondary: true },
              ]
            : []),
          { key: "n", description: "new Story" },
          ...(row?.kind === "story" ? [{ key: "d", description: "delete" }] : []),
          ...(sidebar ? [{ key: "tab", description: "Stages" }] : []),
          { key: "ctrl+p", description: "find" },
          { key: "p", description: "switch Project", secondary: true },
          { key: "f", description: "factory", secondary: true },
          { key: ",", description: "settings", secondary: true },
          { key: "ctrl+b", description: sidebarShown ? "hide Stages" : "show Stages" },
          ...(stage ? [] : [{ key: "←/→", description: "collapse/expand", secondary: true }]),
        ];

  const mainHeight =
    layout.height === undefined ? undefined : Math.max(7, layout.height - HEADER_HEIGHT - FOOTER_HEIGHT);
  // A terminal that is both narrow and short keeps the sidebar beside the list, where each has its full height.
  const stacked =
    sidebar && layout.width < STACKED_BELOW_WIDTH && (mainHeight === undefined || mainHeight >= STACKED_MIN_HEIGHT);
  // The stacked sidebar fits its entries, and it leaves at least half of the main area to the list.
  const stackedHeight =
    stacked && mainHeight !== undefined
      ? Math.min(stages.length + 1 + SIDEBAR_CHROME_HEIGHT, Math.floor(mainHeight / 2))
      : 0;
  // The sidebar can grow until the Story list is narrower than `MAIN_MIN_WIDTH`. A column separates them.
  const gap = sidebar && !stacked ? 1 : 0;
  const room = layout.width - gap - MAIN_MIN_WIDTH;
  const shownWidth = sidebar && !stacked ? Math.max(SIDEBAR_MIN_WIDTH, Math.min(room, sidebarWidth)) : 0;
  // The border and the padding of the Panel take two columns on each side.
  const mainWidth = Math.max(20, layout.width - shownWidth - gap - 4);
  const listHeight = mainHeight === undefined ? undefined : mainHeight - stackedHeight;
  // A problem with the factory state file takes one line below the list. A missing file is no problem.
  const statusLine = board && !["ok", "missing"].includes(board.activity.status) ? 1 : 0;
  const listInnerHeight = listHeight === undefined ? undefined : listHeight - 2 - statusLine;
  // Modals are centred over this area: the inside of the Story panel, and also the sidebar above it when stacked.
  const overlayHeight = mainHeight === undefined ? undefined : mainHeight - 2;
  const overlayBox: BoxProps =
    overlayHeight === undefined
      ? {}
      : { position: "absolute", top: 1, left: shownWidth + gap + 2, width: mainWidth, height: overlayHeight };

  return (
    <Box flexDirection="column" width={layout.width} height={layout.height}>
      <Header
        project={{
          name: projectName ?? (data.loading ? "Loading…" : "No Project"),
          onClick: () => setOverlay({ kind: "projects" }),
        }}
        finder={board ? { onClick: () => setOverlay({ kind: "finder" }) } : undefined}
        factory={board ? { status: factory.data, onClick: () => setOverlay({ kind: "factory" }) } : undefined}
        settings={board ? { onClick: () => setOverlay({ kind: "settings" }) } : undefined}
        newStory={board ? { onClick: () => setOverlay({ kind: "newStory" }), showKey: !sidebarFocused } : undefined}
        clickable={idle}
      />
      <Box flexGrow={1} flexDirection="column">
        <Box flexGrow={1} columnGap={gap} flexDirection={stacked ? "column" : "row"}>
          {sidebar && (
            <Sidebar
              title="Stages"
              entries={[
                { id: ALL_STAGES, label: "All Stages" },
                ...stages.map((s) => ({ id: s.key, label: s.label, editable: true, movable: true })),
              ]}
              current={stageIndex}
              height={stacked ? stackedHeight || undefined : mainHeight}
              width={stacked ? layout.width : shownWidth}
              maxWidth={room}
              onResize={stacked ? undefined : setSidebarWidth}
              focused={sidebarFocused}
              clickable={idle}
              onFocus={() => setPane("stages")}
              onSelect={(id) => setStageKey(id === ALL_STAGES ? null : id)}
              onEdit={(id) => {
                const edited = stages.find((s) => s.key === id);
                if (edited) {
                  setOverlay({ kind: "editStage", stage: edited });
                }
              }}
              // Row 0 is All Stages, so the index of a row is the position of its Stage; a drop on All Stages moves to 1.
              onMove={(id, index) => moveStage(id, index)}
              button={{ label: "+ New Stage", onClick: () => setOverlay({ kind: "newStage" }) }}
            />
          )}
          <Panel
            title={
              projectName ? `${projectName} › ${stage?.label ?? "All Stages"}` : noProject ? "Set up Rowbly" : "Stories"
            }
            focused={listFocused}
            onClick={idle ? () => setPane("stories") : undefined}
            flexGrow={1}
            flexShrink={1}
            height={listHeight}
            overflow="hidden"
          >
            <LayoutContext.Provider value={{ width: mainWidth, height: listInnerHeight }}>
              {data.loading && !data.data ? (
                <Loading label="Loading Stories…" />
              ) : board ? (
                <>
                  <StoryList
                    rows={rows}
                    activity={board.activity.stories}
                    cursor={cursor}
                    clickable={idle}
                    height={listInnerHeight}
                    emptyText={stage ? `No Stories in ${stage.label}.` : "No Stories yet. Press n to create one."}
                    onCursor={(index) => {
                      setPane("stories");
                      selectStory(index);
                    }}
                    onMove={dropStory}
                    onActivate={(index) => {
                      setPane("stories");
                      activateRow(index);
                    }}
                  />
                  {statusLine > 0 && (
                    <Box flexGrow={1} alignItems="flex-end">
                      <FactoryStatusLine activity={board.activity} />
                    </Box>
                  )}
                </>
              ) : noProject ? (
                <ActiveContext.Provider value={idle}>
                  <Onboarding ctx={ctx} onHints={setOnboardingHints} onCreated={reload} />
                </ActiveContext.Provider>
              ) : (
                <Text color={theme.danger}>Rowbly could not read the project.</Text>
              )}
            </LayoutContext.Provider>
          </Panel>
        </Box>
        <Box flexDirection="column" {...overlayBox}>
          <LayoutContext.Provider value={{ width: mainWidth, height: overlayHeight }}>
            {board && overlay?.kind === "finder" && (
              <StoryFinder
                stories={stories}
                stages={stages}
                onClose={close}
                onSelect={(story) => {
                  reveal(story);
                  setPane("stories");
                  setOverlay({ kind: "editStory", story });
                }}
              />
            )}
            {board && overlay?.kind === "newStory" && (
              <NewStoryModal
                ctx={ctx}
                stages={stages}
                customFields={board.project.customFields}
                stage={cursorStage}
                onClose={close}
                onCreated={(story: Story) => {
                  reveal(story);
                  close();
                  reload();
                }}
              />
            )}
            {board && overlay?.kind === "editStory" && (
              <EditStoryModal
                ctx={ctx}
                story={overlay.story}
                stages={stages}
                customFields={board.project.customFields}
                specs={board.project.features?.specs === true}
                onClose={close}
                onSaved={(story: Story) => {
                  reveal(story);
                  close();
                  reload();
                }}
                onDeleted={afterDelete}
              />
            )}
            {board && overlay?.kind === "deleteStory" && (
              <ConfirmDialog
                title={`Delete Story › ${overlay.story.id}`}
                message={deleteStoryMessage(overlay.story)}
                confirmLabel="Delete"
                cancelLabel="Cancel"
                destructive
                onConfirm={() => removeStory(overlay.story)}
                onCancel={close}
              />
            )}
            {board && (overlay?.kind === "newStage" || overlay?.kind === "editStage") && (
              <StageFormModal
                ctx={ctx}
                stage={overlay.kind === "editStage" ? overlay.stage : undefined}
                onClose={close}
                onSaved={(saved) => {
                  setStageKey(saved.key);
                  close();
                  reload();
                }}
              />
            )}
            {board && overlay?.kind === "settings" && (
              <SettingsModal
                ctx={ctx}
                projectName={projectName}
                section={overlay.section}
                onChange={reload}
                onClose={close}
              />
            )}
            {board && overlay?.kind === "factory" && (
              <FactoryModal
                ctx={ctx}
                status={factory.data}
                stages={Object.fromEntries(stages.map((s) => [s.key, s.label]))}
                launch={launch}
                onClose={close}
                onAiSettings={() => setOverlay({ kind: "settings", section: "ai" })}
              />
            )}
            {overlay?.kind === "projects" && (
              <ProjectSwitcher ctx={ctx} current={projectRoot} onSelect={switchProject} onClose={close} />
            )}
            {overlay?.kind === "help" && <HelpModal hints={hints} onClose={close} />}
          </LayoutContext.Provider>
        </Box>
      </Box>
      <Footer hints={overlay ? [] : hints} atRoot />
      <ToastArea />
    </Box>
  );
}
