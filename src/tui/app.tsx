import { Box, Text, useApp, useInput, useStdout, useWindowSize } from 'ink';
import { Component, type ReactNode, useContext, useEffect, useMemo, useState } from 'react';
import { NotFoundError, RowblyError } from '../core';
import type { RowblyContext, Services } from '../services';
import { ConfirmDialog, SelectList } from './components';
import {
  ActiveContext,
  createShellRegistry,
  createToastStore,
  ScreenDepthContext,
  ServicesContext,
  ShellContext,
  type Toast,
  ToastContext,
  type ToastStore,
  useScreenHints,
  useToast,
  useToasts,
} from './hooks';
import { DESTINATIONS, GLOBAL_KEYS, globalAction, type KeyHint } from './keymap';
import { type Route, RouterProvider, routeTitle, useRouter } from './router';
import { screens as defaultScreens, type ScreenRegistry } from './screens';

export interface AppProps {
  ctx: RowblyContext | null;
  services: Services | null;
  initial: Route;
  /** Pass the store that `ctx.warn` feeds; a fresh one is made otherwise. */
  toasts?: ToastStore;
  screens?: ScreenRegistry;
}

/** The whole TUI: providers around the shell. */
export function App({ ctx, services, initial, toasts, screens = defaultScreens }: AppProps) {
  const toastStore = useMemo(() => toasts ?? createToastStore(), [toasts]);
  const shell = useMemo(createShellRegistry, []);
  const servicesValue = useMemo(() => ({ ctx, services }), [ctx, services]);
  return (
    <ServicesContext.Provider value={servicesValue}>
      <ToastContext.Provider value={toastStore}>
        <ShellContext.Provider value={shell}>
          <RouterProvider initial={initial}>
            <Shell screens={screens} />
          </RouterProvider>
        </ShellContext.Provider>
      </ToastContext.Provider>
    </ServicesContext.Provider>
  );
}

type Overlay = { kind: 'help' } | { kind: 'goto' } | { kind: 'confirm'; action: 'quit' | 'back' };

function Shell({ screens }: { screens: ScreenRegistry }) {
  const router = useRouter();
  const shell = useContext(ShellContext);
  const { exit } = useApp();
  const { rows } = useWindowSize();
  // Fill the terminal only on a real one, so test frames stay compact.
  const height = (useStdout().stdout as NodeJS.WriteStream).isTTY ? rows : undefined;
  const [overlay, setOverlay] = useState<Overlay | null>(null);
  const depth = router.stack.length - 1;
  const atRoot = depth === 0;

  const back = () => {
    if (atRoot) return;
    if (shell.isDirty(depth)) setOverlay({ kind: 'confirm', action: 'back' });
    else router.pop();
  };
  const quit = () => {
    if (shell.isDirty()) setOverlay({ kind: 'confirm', action: 'quit' });
    else exit();
  };

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
  });

  const hints = useScreenHints(depth);

  return (
    <Box flexDirection="column" height={height}>
      <Header />
      <Box flexDirection="column" flexGrow={1} paddingX={1} marginY={1}>
        <Box flexDirection="column" display={overlay && overlay.kind !== 'confirm' ? 'none' : 'flex'}>
          {router.stack.map((route, i) => (
            <ScreenSlot
              // biome-ignore lint/suspicious/noArrayIndexKey: a stack position is the screen's identity.
              key={`${i}:${route.screen}`}
              route={route}
              depth={i}
              top={i === depth}
              active={i === depth && overlay === null}
              screens={screens}
            />
          ))}
        </Box>
        {overlay?.kind === 'help' && <HelpOverlay hints={hints} />}
        {overlay?.kind === 'goto' && (
          <GotoPalette
            onPick={(screen) => {
              setOverlay(null);
              router.push(screen);
            }}
          />
        )}
        {overlay?.kind === 'confirm' && (
          <ConfirmDialog
            message={
              overlay.action === 'quit' ? 'Quit and discard unsaved changes?' : 'Go back and discard unsaved changes?'
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
        )}
      </Box>
      <ToastArea />
      <Footer hints={hints} atRoot={atRoot} />
    </Box>
  );
}

function Header() {
  const router = useRouter();
  const { ctx } = useContext(ServicesContext);
  const crumbs = [ctx?.local.workspace, ctx?.local.board, ...router.stack.map(routeTitle)].filter(Boolean);
  return (
    <Box
      justifyContent="space-between"
      paddingX={1}
      borderStyle="single"
      borderTop={false}
      borderLeft={false}
      borderRight={false}
    >
      <Text>
        <Text bold color="cyan">
          Rowbly
        </Text>
        {'  '}
        {crumbs.join(' › ')}
      </Text>
      <Text dimColor>me: {ctx?.me ?? '—'}</Text>
    </Box>
  );
}

function Footer({ hints, atRoot }: { hints: readonly KeyHint[]; atRoot: boolean }) {
  const shown = [
    ...hints,
    ...(atRoot ? [] : [{ key: 'esc', description: 'back' }]),
    { key: 'g', description: 'go to' },
    { key: '?', description: 'help' },
    ...(atRoot ? [{ key: 'q', description: 'quit' }] : []),
  ];
  return (
    <Box paddingX={1}>
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
  const rows = [...hints, ...GLOBAL_KEYS];
  const width = Math.max(...rows.map((row) => row.key.length)) + 2;
  return (
    <Box flexDirection="column" borderStyle="round" paddingX={1} alignSelf="flex-start">
      <Text bold>Keys</Text>
      {rows.map((row) => (
        <Text key={`${row.key}:${row.description}`}>
          <Text color="cyan">{row.key.padEnd(width)}</Text>
          {row.description}
        </Text>
      ))}
      <Text dimColor>esc or ? to close</Text>
    </Box>
  );
}

function GotoPalette({ onPick }: { onPick(screen: string): void }) {
  return (
    <Box flexDirection="column" borderStyle="round" paddingX={1} alignSelf="flex-start">
      <Text bold>Go to</Text>
      <SelectList
        items={DESTINATIONS.map((d) => ({ value: d.screen, label: d.label }))}
        onSelect={(item) => onPick(item.value)}
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
