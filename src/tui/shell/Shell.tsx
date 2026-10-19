import { Box, useApp, useInput, useStdout, useWindowSize } from 'ink';
import { type ReactNode, useContext, useMemo, useState } from 'react';
import { invokePlugin } from '../../services';
import { ConfirmDialog, Modal, Panel } from '../components';
import {
  type BoardSelection,
  BoardSelectionContext,
  LayoutContext,
  type MainOverlay,
  MainOverlayContext,
  pluginUi,
  ServicesContext,
  ShellContext,
  useAsync,
  usePlugins,
  useScreenFocus,
  useScreenHints,
  useScreenLabel,
  useToast,
  useToasts,
} from '../hooks';
import { globalAction, type KeyHint } from '../keymap';
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

type Overlay =
  | { kind: 'help' }
  | { kind: 'confirm'; action: 'quit' | 'back' }
  // A node a screen shows over the whole terminal, such as a full-screen editor.
  | { kind: 'main'; id: string; node: ReactNode };

/**
 * The frame: a header with the project and its actions, the Board sidebar, and the main area. The
 * root screen fills the main area; every screen opened on top of it, and the shell's own overlays,
 * show in a modal over it.
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
  const toastCount = useToasts().length;
  const [overlay, setOverlay] = useState<Overlay | null>(null);
  const mainOverlay = useMemo<MainOverlay>(
    () => ({
      open: (id, node) => setOverlay({ kind: 'main', id, node }),
      close: (id) => setOverlay((current) => (current?.kind === 'main' && current.id === id ? null : current)),
    }),
    [],
  );
  const [boardVersion, setBoardVersion] = useState(0);
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
  const openSettings = () => {
    if (services && !router.stack.some((route) => route.screen === 'settings')) router.push('settings');
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
    if (action === 'back') back();
    else if (action === 'quit' && atRoot) quit();
    else if (action === 'help') setOverlay({ kind: 'help' });
    else if (action === 'settings') openSettings();
    else if (atRoot && services && input === 'N') newBoard();
    else if (atRoot && boards.length > 0) {
      const target = boardKey(input, currentIndex, boards.length);
      const board = target === null ? undefined : boards[target];
      if (board && target !== currentIndex) void selection.select(board.id);
    }
  });

  const hints = [...useScreenHints(depth), ...actionHints];
  const label = useScreenLabel(0);
  const sidebarWidth = services ? SIDEBAR_WIDTH : 0;
  // The main panel's border takes a column on each side.
  const mainWidth = Math.max(20, columns - sidebarWidth - 2);
  const mainHeight = fullscreen ? Math.max(7, rows - HEADER_HEIGHT - FOOTER_HEIGHT - toastCount) : undefined;
  const innerHeight = mainHeight === undefined ? undefined : mainHeight - 2;
  const screenHidden = overlay !== null && overlay.kind !== 'confirm';
  const top = router.stack[depth];

  return (
    <BoardSelectionContext.Provider value={selection}>
      <MainOverlayContext.Provider value={mainOverlay}>
        <Box flexDirection="column" height={fullscreen ? rows : undefined}>
          <Header
            label={label}
            onNewStory={services ? newStory : undefined}
            clickable={idle}
            actions={actions}
            actionsClickable={overlay === null}
          />
          <Box flexGrow={1}>
            {services && (
              <Sidebar
                boards={boards}
                current={currentIndex}
                height={mainHeight}
                clickable={idle}
                onSelect={(boardId) => void selection.select(boardId)}
                onNewBoard={newBoard}
              />
            )}
            <Panel
              title={router.stack[0] ? routeTitle(router.stack[0]) : undefined}
              color={idle ? 'cyan' : undefined}
              flexGrow={1}
              flexShrink={1}
              height={mainHeight}
              overflow="hidden"
            >
              <LayoutContext.Provider value={{ width: mainWidth, height: innerHeight }}>
                {router.stack[0] && (
                  <Box flexDirection="column" display={screenHidden && !fullscreen ? 'none' : 'flex'}>
                    <ScreenSlot route={router.stack[0]} depth={0} top active={idle} screens={screens} />
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
                    <Modal title={router.stack.map(routeTitle).join(' › ')} hints={modalHints(hints)}>
                      {router.stack.slice(1).map((route, i) => (
                        <ScreenSlot
                          // biome-ignore lint/suspicious/noArrayIndexKey: a stack position is the screen's identity.
                          key={`${i + 1}:${route.screen}`}
                          route={route}
                          depth={i + 1}
                          top={i + 1 === depth}
                          active={i + 1 === depth && overlay === null}
                          screens={screens}
                        />
                      ))}
                    </Modal>
                  </Box>
                )}
                {overlay?.kind === 'help' && (
                  <Modal title="Keys" size="dialog">
                    <HelpOverlay hints={hints} />
                  </Modal>
                )}
                {overlay?.kind === 'confirm' && (
                  <Modal size="dialog">
                    <ConfirmDialog
                      message={
                        overlay.action === 'quit'
                          ? 'Quit and discard unsaved changes?'
                          : 'Go back and discard unsaved changes?'
                      }
                      confirmLabel="Discard"
                      cancelLabel="Keep editing"
                      destructive
                      onConfirm={() => {
                        setOverlay(null);
                        if (overlay.action === 'quit') exit();
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
      </MainOverlayContext.Provider>
    </BoardSelectionContext.Provider>
  );
}

/** The keys shown along the bottom of a screen's modal: its own, then `esc` unless it took that over. */
function modalHints(hints: readonly KeyHint[]): KeyHint[] {
  return hints.some((hint) => hint.key === 'esc') ? [...hints] : [...hints, { key: 'esc', description: 'back' }];
}
