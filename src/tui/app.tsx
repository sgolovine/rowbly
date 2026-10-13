import type { EventEmitter } from 'node:events';
import { basename, dirname } from 'node:path';
import { Box, type DOMElement, Text, useApp, useInput, useStdout, useWindowSize } from 'ink';
import { Component, type ReactNode, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { NotFoundError, RowblyError } from '../core';
import type { BoardConfig } from '../schemas';
import { createServices, type RowblyContext, type Services } from '../services';
import { ConfirmDialog, Modal, SelectList } from './components';
import {
  ActiveContext,
  type BoardSelection,
  BoardSelectionContext,
  createMouseRegistry,
  createShellRegistry,
  createToastStore,
  LayoutContext,
  MouseContext,
  ScreenDepthContext,
  ServicesContext,
  ShellContext,
  type Toast,
  ToastContext,
  type ToastStore,
  useAsync,
  useMouse,
  useMouseSource,
  useScreenHints,
  useToast,
  useToasts,
} from './hooks';
import { DESTINATIONS, type Destination, GLOBAL_KEYS, globalAction, type KeyHint } from './keymap';
import { type Route, RouterProvider, routeTitle, useRouter } from './router';
import { screens as defaultScreens, type ScreenRegistry } from './screens';

export interface AppProps {
  ctx: RowblyContext | null;
  services: Services | null;
  initial: Route;
  /** Pass the store that `ctx.warn` feeds; a fresh one is made otherwise. */
  toasts?: ToastStore;
  screens?: ScreenRegistry;
  /** Emits the `mouse` events read by `MouseStdin`; without it the app is keyboard-only. */
  mouse?: EventEmitter;
}

/** The whole TUI: providers around the shell. */
export function App({ ctx, services, initial, toasts, screens = defaultScreens, mouse }: AppProps) {
  const toastStore = useMemo(() => toasts ?? createToastStore(), [toasts]);
  const shell = useMemo(createShellRegistry, []);
  const mouseRegistry = useMemo(createMouseRegistry, []);
  useMouseSource(mouseRegistry, mouse);
  const [current, setCurrent] = useState({ ctx, services });
  const servicesValue = useMemo(
    () => ({
      ...current,
      activate: (next: RowblyContext) => setCurrent({ ctx: next, services: createServices(next) }),
    }),
    [current],
  );
  return (
    <ServicesContext.Provider value={servicesValue}>
      <ToastContext.Provider value={toastStore}>
        <ShellContext.Provider value={shell}>
          <MouseContext.Provider value={mouseRegistry}>
            <RouterProvider initial={initial}>
              <Shell screens={screens} />
            </RouterProvider>
          </MouseContext.Provider>
        </ShellContext.Provider>
      </ToastContext.Provider>
    </ServicesContext.Provider>
  );
}

type Overlay = { kind: 'help' } | { kind: 'goto' } | { kind: 'confirm'; action: 'quit' | 'back' };

/** Width of the Board sidebar, including its border. */
export const SIDEBAR_WIDTH = 22;
/** Lines taken by the header (with its rule) and the footer. */
const HEADER_HEIGHT = 2;
const FOOTER_HEIGHT = 1;

/**
 * The frame: a header with the project and its actions, the Board sidebar, and the main area. The
 * root screen fills the main area; every screen opened on top of it, and the shell's own overlays,
 * show in a modal over it.
 */
function Shell({ screens }: { screens: ScreenRegistry }) {
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
  const [boardVersion, setBoardVersion] = useState(0);
  const depth = router.stack.length - 1;
  const atRoot = depth === 0;
  const idle = atRoot && overlay === null;

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

  useInput((input, key) => {
    const captured = shell.captured();
    if (key.escape && captured.escape) return;
    if (overlay) {
      if (overlay.kind === 'help' && (key.escape || input === '?' || input === 'q')) setOverlay(null);
      if (overlay.kind === 'goto' && key.escape) setOverlay(null);
      return;
    }
    if (captured.text && !key.escape) return;
    const action = globalAction(input, key);
    if (action === 'back') back();
    else if (action === 'quit' && atRoot) quit();
    else if (action === 'help') setOverlay({ kind: 'help' });
    else if (action === 'goto') setOverlay({ kind: 'goto' });
    else if (atRoot && services && input === 'N') newBoard();
    else if (atRoot && boards.length > 0) {
      const target = boardKey(input, currentIndex, boards.length);
      const board = target === null ? undefined : boards[target];
      if (board && target !== currentIndex) void selection.select(board.id);
    }
  });

  const hints = useScreenHints(depth);
  const sidebarWidth = services ? SIDEBAR_WIDTH : 0;
  // The main area is padded by one column on each side.
  const mainWidth = Math.max(20, columns - sidebarWidth - 2);
  const mainHeight = fullscreen ? Math.max(5, rows - HEADER_HEIGHT - FOOTER_HEIGHT - toastCount) : undefined;
  const screenHidden = overlay !== null && overlay.kind !== 'confirm';
  const top = router.stack[depth];

  return (
    <BoardSelectionContext.Provider value={selection}>
      <Box flexDirection="column" height={fullscreen ? rows : undefined}>
        <Header onNewStory={services ? newStory : undefined} clickable={idle} />
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
          <Box flexDirection="column" flexGrow={1} flexShrink={1} paddingX={1} height={mainHeight} overflow="hidden">
            <LayoutContext.Provider value={{ width: mainWidth, height: mainHeight }}>
              {router.stack[0] && (
                <Box flexDirection="column" display={screenHidden && !fullscreen ? 'none' : 'flex'}>
                  <ScreenSlot route={router.stack[0]} depth={0} top active={idle} screens={screens} />
                </Box>
              )}
              {depth > 0 && top && (
                <Box display={screenHidden ? 'none' : 'flex'} flexDirection="column">
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
              {overlay?.kind === 'goto' && (
                <Modal title="Go to" size="dialog">
                  <GotoPalette
                    onPick={(destination) => {
                      setOverlay(null);
                      router.push(destination.screen, destination.params);
                    }}
                  />
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
          </Box>
        </Box>
        <ToastArea />
        <Footer hints={atRoot ? hints : []} atRoot={atRoot} />
      </Box>
    </BoardSelectionContext.Provider>
  );
}

/** The keys shown along the bottom of a screen's modal: its own, then `esc` unless it took that over. */
function modalHints(hints: readonly KeyHint[]): KeyHint[] {
  return hints.some((hint) => hint.key === 'esc') ? [...hints] : [...hints, { key: 'esc', description: 'back' }];
}

/** The sidebar index a Board key selects: `[`/`]` step and wrap, `1`–`9` jump. */
export function boardKey(input: string, current: number, count: number): number | null {
  if (input === '[') return (Math.max(current, 0) - 1 + count) % count;
  if (input === ']') return (current + 1) % count;
  if (/^[1-9]$/.test(input) && Number(input) <= count) return Number(input) - 1;
  return null;
}

/** The project the Data Root belongs to: the folder holding `.rowbly`, or "Global" for `~/.rowbly`. */
export function projectName(ctx: RowblyContext | null): string {
  if (!ctx) return 'Rowbly';
  if (ctx.root.kind === 'global') return 'Global';
  return basename(dirname(ctx.root.path)) || 'Rowbly';
}

function Header({ onNewStory, clickable }: { onNewStory?: () => void; clickable: boolean }) {
  const { ctx } = useContext(ServicesContext);
  return (
    <Box
      justifyContent="space-between"
      paddingX={1}
      borderStyle="single"
      borderTop={false}
      borderLeft={false}
      borderRight={false}
      borderDimColor
      flexShrink={0}
    >
      <Text bold color="cyan" wrap="truncate-end">
        {projectName(ctx)}
      </Text>
      <Box gap={2} flexShrink={0}>
        <Text dimColor>me: {ctx?.me ?? '—'}</Text>
        {onNewStory && <HeaderButton label="+ New Story" onClick={onNewStory} clickable={clickable} />}
      </Box>
    </Box>
  );
}

function HeaderButton({ label, onClick, clickable }: { label: string; onClick(): void; clickable: boolean }) {
  const ref = useRef<DOMElement>(null);
  useMouse(ref, { onClick }, clickable);
  return (
    <Box ref={ref}>
      <Text inverse color="cyan">{` ${label} `}</Text>
    </Box>
  );
}

function Sidebar({
  boards,
  current,
  height,
  clickable,
  onSelect,
  onNewBoard,
}: {
  boards: readonly BoardConfig[];
  current: number;
  height?: number;
  clickable: boolean;
  onSelect(boardId: string): void;
  onNewBoard(): void;
}) {
  return (
    <Box
      flexDirection="column"
      width={SIDEBAR_WIDTH}
      height={height}
      flexShrink={0}
      paddingX={1}
      borderStyle="single"
      borderTop={false}
      borderBottom={false}
      borderLeft={false}
      borderDimColor
    >
      <Text dimColor bold>
        BOARDS
      </Text>
      <Box flexDirection="column" marginTop={1}>
        {boards.length === 0 && <Text dimColor>No Boards yet.</Text>}
        {boards.map((board, i) => (
          <SidebarItem
            key={board.id}
            index={i}
            name={board.name}
            selected={i === current}
            clickable={clickable}
            onClick={() => onSelect(board.id)}
          />
        ))}
      </Box>
      <Box flexGrow={1} minHeight={1} />
      <Box gap={1}>
        <HeaderButton label="+ New Board" onClick={onNewBoard} clickable={clickable} />
        <Text dimColor>N</Text>
      </Box>
    </Box>
  );
}

function SidebarItem({
  index,
  name,
  selected,
  clickable,
  onClick,
}: {
  index: number;
  name: string;
  selected: boolean;
  clickable: boolean;
  onClick(): void;
}) {
  const ref = useRef<DOMElement>(null);
  useMouse(ref, { onClick }, clickable);
  return (
    <Box ref={ref}>
      <Text wrap="truncate-end" color={selected ? 'cyan' : undefined} bold={selected}>
        {selected ? '▌ ' : '  '}
        <Text dimColor={!selected}>{index < 9 ? `${index + 1} ` : '  '}</Text>
        {name}
      </Text>
    </Box>
  );
}

function Footer({ hints, atRoot }: { hints: readonly KeyHint[]; atRoot: boolean }) {
  // Away from the root the screen's keys are on its modal; this keeps to the global ones.
  const shown = [
    ...hints,
    { key: 'g', description: 'go to' },
    { key: '?', description: 'help' },
    ...(atRoot ? [{ key: 'q', description: 'quit' }] : []),
  ];
  return (
    <Box paddingX={1} flexShrink={0}>
      <Text dimColor wrap="truncate-end">
        {shown.map((hint) => `${hint.key} ${hint.description}`).join(' · ')}
      </Text>
    </Box>
  );
}

const TOAST_COLORS = { info: 'cyan', warning: 'yellow', error: 'red' } as const;
const TOAST_MS = { info: 4000, warning: 6000, error: 8000 } as const;

function ToastArea() {
  const toasts = useToasts();
  if (toasts.length === 0) return null;
  return (
    <Box flexDirection="column" paddingX={1}>
      {toasts.map((toast) => (
        <ToastLine key={toast.id} toast={toast} />
      ))}
    </Box>
  );
}

function ToastLine({ toast }: { toast: Toast }) {
  const store = useToast();
  useEffect(() => {
    const timer = setTimeout(() => store.dismiss(toast.id), TOAST_MS[toast.kind]);
    return () => clearTimeout(timer);
  }, [store, toast]);
  return (
    <Text color={TOAST_COLORS[toast.kind]}>
      {toast.kind === 'info' ? '' : `${toast.kind}: `}
      {toast.message}
    </Text>
  );
}

function HelpOverlay({ hints }: { hints: readonly KeyHint[] }) {
  // A screen's own meaning for a key (e.g. `/` on the board, `esc` in a form) replaces the global one.
  const rows = [...hints, ...GLOBAL_KEYS.filter((global) => !hints.some((hint) => hint.key === global.key))];
  const width = Math.max(...rows.map((row) => row.key.length)) + 2;
  return (
    <Box flexDirection="column">
      {rows.map((row) => (
        <Text key={`${row.key}:${row.description}`}>
          <Text color="cyan">{row.key.padEnd(width)}</Text>
          {row.description}
        </Text>
      ))}
    </Box>
  );
}

function GotoPalette({ onPick }: { onPick(destination: Destination): void }) {
  return (
    <Box flexDirection="column">
      <SelectList
        items={DESTINATIONS.map((d) => ({ value: d.label, label: d.label }))}
        limit={DESTINATIONS.length}
        onSelect={(item) => {
          const destination = DESTINATIONS.find((d) => d.label === item.value);
          if (destination) onPick(destination);
        }}
      />
    </Box>
  );
}

function ScreenSlot({
  route,
  depth,
  top,
  active,
  screens,
}: {
  route: Route;
  depth: number;
  top: boolean;
  active: boolean;
  screens: ScreenRegistry;
}) {
  const toast = useToast();
  const Screen = screens[route.screen];
  return (
    <ScreenDepthContext.Provider value={depth}>
      <ActiveContext.Provider value={active}>
        <Box flexDirection="column" display={top ? 'flex' : 'none'}>
          <ScreenBoundary onError={(err) => toast.error(err)}>
            {Screen ? (
              <Screen params={route.params} />
            ) : (
              <MissingScreen
                name={route.screen}
                onMount={() => toast.error(new NotFoundError(`screen "${route.screen}" is not available`))}
              />
            )}
          </ScreenBoundary>
        </Box>
      </ActiveContext.Provider>
    </ScreenDepthContext.Provider>
  );
}

function MissingScreen({ name, onMount }: { name: string; onMount(): void }) {
  // biome-ignore lint/correctness/useExhaustiveDependencies: report once, when the screen opens.
  useEffect(onMount, []);
  return <Text dimColor>The "{name}" screen is not available yet. Press esc to go back.</Text>;
}

interface BoundaryProps {
  onError(err: RowblyError): void;
  children: ReactNode;
}

/** Turns a `RowblyError` thrown while rendering a screen into a toast; anything else is a bug and crashes. */
class ScreenBoundary extends Component<BoundaryProps, { error: unknown }> {
  override state = { error: undefined as unknown };

  static getDerivedStateFromError(error: unknown) {
    return { error };
  }

  override componentDidCatch(error: unknown) {
    if (error instanceof RowblyError) this.props.onError(error);
  }

  override render() {
    const { error } = this.state;
    if (error === undefined) return this.props.children;
    if (!(error instanceof RowblyError)) throw error;
    return <Text color="red">This screen could not be shown: {error.message}. Press esc to go back.</Text>;
  }
}
