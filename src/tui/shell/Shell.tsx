import { Box, useApp, useInput, useStdout, useWindowSize } from 'ink';
import { type ReactNode, useContext, useEffect, useMemo, useState } from 'react';
import { invokePlugin } from '../../services';
import { ConfirmDialog, Modal, Panel } from '../components';
import {
  ActiveContext,
  type BoardSelection,
  BoardSelectionContext,
  type BoardView,
  BoardViewContext,
  LayoutContext,
  type MainOverlay,
  MainOverlayContext,
  pluginUi,
  ServicesContext,
  ShellContext,
  SidebarFilterContext,
  useAsync,
  usePlugins,
  useScreenFocus,
  useScreenHints,
  useScreenLabel,
  useToast,
} from '../hooks';
import { globalAction, type KeyHint, moveDelta } from '../keymap';
import { routeTitle, useRouter } from '../router';
import type { ScreenRegistry } from '../screens';
import { bindAction } from './actionFocus';
import { boardKey } from './boardKey';
import { Footer } from './Footer';
import { Header, type HeaderAction } from './Header';
import { HelpOverlay } from './HelpOverlay';
import { FOOTER_HEIGHT, HEADER_HEIGHT, SIDEBAR_WIDTH } from './layout';
import { ScreenSlot } from './ScreenSlot';
import { Sidebar } from './Sidebar';
import { ToastArea } from './ToastArea';
import { usePluginSidebars } from './usePluginSidebars';

type Overlay =
  | { kind: 'help' }
  | { kind: 'confirm'; action: 'quit' | 'back' | 'settings' }
  // A node a screen shows over the whole terminal, such as a full-screen editor.
  | { kind: 'main'; id: string; node: ReactNode };

/** The part of the frame that takes `↑`/`↓` and `n` at the root: the main area or a sidebar. */
type Pane = 'main' | 'boards' | 'plugin';

/**
 * The frame: a header with the project and its actions, the Board sidebar, the Plugin Sidebar shown
 * beside it, if any, and the main area. The root screen fills the main area; every screen opened on
 * top of it, and the shell's own overlays, show in a modal over it.
 */
export function Shell({ screens }: { screens: ScreenRegistry }) {
  const router = useRouter();
  const shell = useContext(ShellContext);
  const { ctx, services } = useContext(ServicesContext);
  const toast = useToast();
  const { exit } = useApp();
  const { columns, rows } = useWindowSize();
  // Fill the terminal only on a real one, so test frames stay compact.
  const fullscreen = (useStdout().stdout as NodeJS.WriteStream).isTTY === true;

  const [overlay, setOverlay] = useState<Overlay | null>(null);
  const mainOverlay = useMemo<MainOverlay>(
    () => ({
      open: (id, node) => setOverlay({ kind: 'main', id, node }),
      close: (id) => setOverlay((current) => (current?.kind === 'main' && current.id === id ? null : current)),
    }),
    [],
  );
  const [boardVersion, setBoardVersion] = useState(0);
  // Every launch starts with the Stages side by side; the choice then lasts until Rowbly quits.
  const [boardView, setBoardView] = useState<BoardView>('stages');
  const boardViewChoice = useMemo(() => ({ view: boardView, setView: setBoardView }), [boardView]);
  const depth = router.stack.length - 1;
  const atRoot = depth === 0;
  const idle = atRoot && overlay === null;
  const { plugins } = usePlugins();
  const focus = useScreenFocus(depth);

  // The Plugin Actions whose target is in focus on the top screen (ADR-0017).
  const actions: HeaderAction[] = services
    ? plugins.flatMap((plugin) =>
        plugin.actions.flatMap((action) => {
          const run = bindAction(action, focus);
          if (!run) return [];
          return [
            {
              key: action.key,
              label: action.label,
              run: () => {
                const ui = pluginUi(plugin.id, router, toast);
                // The adapter turns a synchronous throw and a rejection alike into one attributed
                // error, shown once as a toast (ADR-0020 §5). Work the Action leaves running is outside it.
                invokePlugin({ plugin: plugin.id, stage: 'screen' }, () =>
                  run({ plugin: services.plugins.context(plugin.id), ui }),
                ).catch((err: unknown) => toast.error(err));
              },
            },
          ];
        }),
      )
    : [];
  const actionHints: KeyHint[] = actions.map((action) => ({ key: action.key, description: action.label }));

  const selection = useMemo<BoardSelection>(
    () => ({
      version: boardVersion,
      async select(boardId) {
        if (!services) return;
        try {
          await services.context.use(boardId);
          setBoardVersion((v) => v + 1);
          if (router.stack[0]?.screen !== 'board') router.reset('board');
        } catch (err) {
          toast.error(err);
        }
      },
    }),
    [boardVersion, services, router, toast],
  );

  const pluginSidebars = usePluginSidebars(depth);
  // A click in a sidebar focuses it and one in the main area focuses that; `esc` goes back to the main area.
  const [pane, setPane] = useState<Pane>('main');
  const pluginShown = pluginSidebars.shown !== null;
  useEffect(() => {
    if (!pluginShown) setPane((was) => (was === 'plugin' ? 'main' : was));
  }, [pluginShown]);
  const sidebarFocused = idle && pane !== 'main';
  // `depth` reloads the list when a modal closes, e.g. after creating a Board.
  const sidebar = useAsync(async () => (services ? services.boards.list() : null), [services, boardVersion, depth]);
  const boards = sidebar.data ?? [];
  // Read on every render: other screens (Context) switch the Board in `ctx.local` directly. Like
  // `resolveBoard`, without a context Board the only Board is the current one.
  const contextIndex = boards.findIndex((b) => b.id === ctx?.local.board);
  const currentIndex = contextIndex < 0 && boards.length === 1 ? 0 : contextIndex;

  const back = () => {
    if (atRoot) return;
    if (shell.isDirty(depth)) setOverlay({ kind: 'confirm', action: 'back' });
    else router.pop();
  };
  const quit = () => {
    if (shell.isDirty()) setOverlay({ kind: 'confirm', action: 'quit' });
    else exit();
  };
  const newStory = () => router.push('story-form', { title: 'New Story' });
  const newBoard = () => router.push('board-form', { title: 'New Board' });
  const pluginCreate = pluginSidebars.shown?.button;
  // Two screen modals never stack: Settings replaces an open Story and the tasks opened over it.
  const story = router.stack.findIndex((route) => route.screen === 'story');
  const replaceStory = () => router.replaceAt(story, 'settings');
  const openSettings = () => {
    if (!services || router.stack.some((route) => route.screen === 'settings')) return;
    if (story < 0) router.push('settings');
    else if (router.stack.some((_, at) => at > story && shell.isDirty(at))) {
      setOverlay({ kind: 'confirm', action: 'settings' });
    } else replaceStory();
  };

  useInput((input, key) => {
    const captured = shell.captured();
    if (key.escape && captured.escape) return;
    if (overlay) {
      if (overlay.kind === 'help' && (key.escape || input === '?' || input === 'q')) setOverlay(null);
      return;
    }
    if (captured.text && !key.escape) return;
    const pluginAction = actions.find((a) => a.key === input);
    if (pluginAction && !key.ctrl && !key.meta) return pluginAction.run();
    const action = globalAction(input, key);
    const delta = sidebarFocused ? moveDelta(input, key) : 0;
    if (action === 'back' && sidebarFocused) setPane('main');
    else if (action === 'back') back();
    else if (action === 'quit' && atRoot) quit();
    else if (action === 'help') setOverlay({ kind: 'help' });
    else if (action === 'settings') openSettings();
    else if (sidebarFocused && pane === 'boards' && delta && boards.length > 0) {
      const board = boards[boardKey(delta < 0 ? '[' : ']', currentIndex, boards.length) ?? currentIndex];
      if (board && board.id !== boards[currentIndex]?.id) void selection.select(board.id);
    } else if (sidebarFocused && pane === 'plugin' && delta) pluginSidebars.step(delta);
    else if (sidebarFocused && pane === 'boards' && input === 'n') newBoard();
    else if (sidebarFocused && pane === 'plugin' && input === 'n') pluginCreate?.onClick();
    else if (atRoot && input === '\\') pluginSidebars.cycle();
    else if (atRoot && input === '{') pluginSidebars.step(-1);
    else if (atRoot && input === '}') pluginSidebars.step(1);
    else if (atRoot && boards.length > 0) {
      const target = boardKey(input, currentIndex, boards.length);
      const board = target === null ? undefined : boards[target];
      if (board && target !== currentIndex) void selection.select(board.id);
    }
  });

  const screenHints = useScreenHints(depth);
  const hints = [...(sidebarFocused ? sidebarHints(pane, pluginCreate?.label) : screenHints), ...actionHints];
  const label = useScreenLabel(0);
  const sidebarWidth = services ? SIDEBAR_WIDTH * (pluginSidebars.shown ? 2 : 1) : 0;
  // The main panel's border takes a column on each side.
  const mainWidth = Math.max(20, columns - sidebarWidth - 4 - (services ? (pluginSidebars.shown ? 2 : 1) : 0));
  const mainHeight = fullscreen ? Math.max(7, rows - HEADER_HEIGHT - FOOTER_HEIGHT) : undefined;
  const innerHeight = mainHeight === undefined ? undefined : mainHeight - 2;
  const screenHidden = overlay?.kind === 'main';
  const top = router.stack[depth];

  return (
    <BoardSelectionContext.Provider value={selection}>
      <BoardViewContext.Provider value={boardViewChoice}>
        <MainOverlayContext.Provider value={mainOverlay}>
          <SidebarFilterContext.Provider value={pluginSidebars.filter}>
            <Box flexDirection="column" height={fullscreen ? rows : undefined}>
              <Header
                label={label}
                onNewStory={services ? newStory : undefined}
                newStoryKey={!sidebarFocused}
                onSettings={services ? openSettings : undefined}
                clickable={idle}
                actions={actions}
                actionsClickable={overlay === null}
                boardView={
                  router.stack[0]?.screen === 'board' ? { view: boardView, onChange: setBoardView } : undefined
                }
                sidebars={pluginSidebars.buttons}
              />
              <Box flexGrow={1} columnGap={1}>
                {services && (
                  <Sidebar
                    title="Boards"
                    entries={boards.map((board) => ({ id: board.id, label: board.name }))}
                    current={currentIndex}
                    emptyText="No Boards yet."
                    numbered
                    height={mainHeight}
                    focused={idle && pane === 'boards'}
                    clickable={idle}
                    onFocus={() => setPane('boards')}
                    onSelect={(boardId) => void selection.select(boardId)}
                    button={{ label: '+ New Board', onClick: newBoard }}
                  />
                )}
                {services && pluginSidebars.shown && (
                  <Sidebar
                    title={pluginSidebars.shown.title}
                    entries={pluginSidebars.shown.entries}
                    current={pluginSidebars.shown.current}
                    height={mainHeight}
                    focused={idle && pane === 'plugin'}
                    clickable={idle}
                    onFocus={() => setPane('plugin')}
                    onSelect={pluginSidebars.pick}
                    button={pluginSidebars.shown.button}
                  />
                )}
                <Panel
                  title={router.stack[0] ? routeTitle(router.stack[0]) : undefined}
                  focused={idle && pane === 'main'}
                  onClick={idle ? () => setPane('main') : undefined}
                  flexGrow={1}
                  flexShrink={1}
                  height={mainHeight}
                  overflow="hidden"
                >
                  <LayoutContext.Provider value={{ width: mainWidth, height: innerHeight }}>
                    {router.stack[0] && (
                      <Box flexDirection="column" display={screenHidden && !fullscreen ? 'none' : 'flex'}>
                        {/* Keyed by the Data Root, so switching to another one starts the screen again. */}
                        <ScreenSlot
                          key={ctx?.root.path}
                          route={router.stack[0]}
                          depth={0}
                          top
                          active={idle && pane === 'main'}
                          screens={screens}
                        />
                      </Box>
                    )}
                    {depth > 0 && top && (
                      // Pinned to the top of the main area so the Modal centres there rather than below
                      // the root screen's content.
                      <Box
                        display={screenHidden ? 'none' : 'flex'}
                        flexDirection="column"
                        position={fullscreen ? 'absolute' : 'relative'}
                        top={0}
                        left={0}
                        width="100%"
                      >
                        {router.stack.slice(1).map((route, i) => {
                          const routeDepth = i + 1;
                          const screen = route.screen === 'story' || route.screen === 'settings';
                          const visible =
                            routeDepth === depth ||
                            (screen &&
                              !router.stack
                                .slice(routeDepth + 1)
                                .some((next) => next.screen === 'story' || next.screen === 'settings'));
                          const focused = routeDepth === depth && overlay === null;
                          return (
                            <Box
                              key={`${routeDepth}:${route.screen}`}
                              display={visible ? 'flex' : 'none'}
                              flexDirection="column"
                              position={fullscreen ? 'absolute' : 'relative'}
                              top={0}
                              left={0}
                              width="100%"
                            >
                              <ActiveContext.Provider value={focused}>
                                <Modal
                                  title={router.stack
                                    .slice(0, routeDepth + 1)
                                    .map(routeTitle)
                                    .join(' › ')}
                                  size={screen ? 'screen' : 'panel'}
                                  focused={focused}
                                  onClose={focused ? back : undefined}
                                  hints={modalHints(focused ? hints : [])}
                                >
                                  <ScreenSlot route={route} depth={routeDepth} top active={focused} screens={screens} />
                                </Modal>
                              </ActiveContext.Provider>
                            </Box>
                          );
                        })}
                      </Box>
                    )}
                    {overlay?.kind === 'help' && (
                      <Modal title="Keys" size="dialog" onClose={() => setOverlay(null)}>
                        <HelpOverlay hints={hints} />
                      </Modal>
                    )}
                    {overlay?.kind === 'confirm' && (
                      <Modal size="dialog" title="Discard changes" onClose={() => setOverlay(null)}>
                        <ConfirmDialog
                          message={
                            overlay.action === 'quit'
                              ? 'Quit and discard unsaved changes?'
                              : overlay.action === 'settings'
                                ? 'Open Settings and discard unsaved changes?'
                                : 'Go back and discard unsaved changes?'
                          }
                          confirmLabel="Discard"
                          cancelLabel="Keep editing"
                          destructive
                          onConfirm={() => {
                            setOverlay(null);
                            if (overlay.action === 'quit') exit();
                            else if (overlay.action === 'settings') replaceStory();
                            else router.pop();
                          }}
                          onCancel={() => setOverlay(null)}
                        />
                      </Modal>
                    )}
                  </LayoutContext.Provider>
                </Panel>
              </Box>
              <ToastArea />
              <Footer hints={atRoot ? hints : []} atRoot={atRoot} />
              {overlay?.kind === 'main' && (
                // Over the whole terminal rather than the main area; the Modal keeps its margin to the edges.
                <LayoutContext.Provider value={{ width: columns, height: fullscreen ? rows : undefined }}>
                  {overlay.node}
                </LayoutContext.Provider>
              )}
            </Box>
          </SidebarFilterContext.Provider>
        </MainOverlayContext.Provider>
      </BoardViewContext.Provider>
    </BoardSelectionContext.Provider>
  );
}

/** The keys of a focused sidebar, which replace the root screen's; `create` is its button's label. */
function sidebarHints(pane: Pane, create: string | undefined): KeyHint[] {
  const hints: KeyHint[] = [{ key: '↑/↓', description: pane === 'boards' ? 'select Board' : 'select' }];
  if (pane === 'boards') hints.push({ key: 'n', description: 'new Board' });
  else if (create) hints.push({ key: 'n', description: create.replace(/^\+\s*/, '').replace(/^New\b/, 'new') });
  hints.push(
    { key: 'esc', description: 'back to the main area' },
    { key: 'j/k', description: 'select (vim keys)', secondary: true },
  );
  return hints;
}

/** The keys shown along the bottom of a screen's modal: its own, then `esc` unless it took that over. */
function modalHints(hints: readonly KeyHint[]): KeyHint[] {
  return hints.some((hint) => hint.key === 'esc') ? [...hints] : [...hints, { key: 'esc', description: 'back' }];
}
