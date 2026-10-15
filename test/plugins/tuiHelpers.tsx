// The TUI with Plugins, opened as the entry point opens it, and keyboard helpers that find a field or
// a list item by what it shows instead of by counting key presses.
import { stripVTControlCharacters } from 'node:util';
import { reservedNames } from '../../src/main';
import {
  type AnyPluginDefinition,
  createServices,
  loadPlugins,
  type PluginHost,
  type RowblyContext,
  type Services,
} from '../../src/services';
import { App } from '../../src/tui/app';
import { createToastStore, type ToastStore } from '../../src/tui/hooks';
import { type PluginLoader, withPlugins } from '../../src/tui/loadPlugins';
import type { Route } from '../../src/tui/router';
import { fixedClock, fixedIds, type TempRoot } from '../helpers';
import { KEYS, type Rendered, renderTui, waitForFrame } from '../tui/helpers';

export interface PluginApp {
  app: Rendered;
  ctx: RowblyContext;
  services: Services;
  host: PluginHost;
  /** The toast store the App shows; `ctx.warn` and load failures feed it. */
  toasts: ToastStore;
  /** Every warning pushed to `toasts`, kept after the toast itself drops off the screen. */
  warnings: string[];
}

/**
 * Renders the App over `t` with the Plugins of `registry` that `t` turns on, as `startTui` does:
 * the same loader loads them now and again on reload, reactions run in the background, and
 * `ctx.warn` and load failures show as toasts in the store the App renders.
 */
export async function openPluginApp(
  t: TempRoot,
  registry: readonly AnyPluginDefinition[],
  initial: Route,
  ctxOverrides: Partial<RowblyContext> = {},
): Promise<PluginApp> {
  const warnings: string[] = [];
  const shown = createToastStore();
  const toasts: ToastStore = {
    ...shown,
    push(kind, message) {
      if (kind === 'warning') warnings.push(message);
      shown.push(kind, message);
    },
  };
  const loader: PluginLoader = (root) => loadPlugins({ root, registry, reserved: reservedNames() });
  const ctx: RowblyContext = {
    root: t.root,
    local: { version: 1 },
    me: null,
    now: fixedClock().now,
    newId: fixedIds(),
    warn: (message) => toasts.push('warning', message),
    ...ctxOverrides,
  };
  const plugins = await withPlugins(ctx, loader, toasts);
  const host = ctx.plugins;
  if (!host) throw new Error('openPluginApp: the loader set no Plugin host');
  const services = createServices(ctx);
  const app = renderTui(
    <App ctx={ctx} services={services} initial={initial} toasts={toasts} plugins={plugins} loadPlugins={loader} />,
  );
  return { app, ctx, services, host, toasts, warnings };
}

/** At most this many key presses look for a field or an item before the helpers give up. */
const MAX_PRESSES = 30;
/** What stands right before a marker: the start of a line or a panel's border, then indentation. */
const EDGE = '(?:^|[│┃║])[ \\t]*';

/**
 * Presses `tab` until the focused row of the form on screen (`Form` marks it `› `) is the field
 * labelled `label`, and returns that frame. Fails with the last frame when the field is not there.
 */
export function focusFormField(app: Rendered, label: string): Promise<string> {
  return moveTo(app, { what: 'form field', label, key: KEYS.tab, marker: '›' });
}

/**
 * Presses `key` (`j` by default) until the cursor row of a list (marked `› `, or `▌ ` in the
 * settings sections) shows `label`, and returns that frame. It does not open the item. Fails with
 * the last frame when the item is not there.
 */
export function focusListItem(app: Rendered, label: string, key = 'j'): Promise<string> {
  return moveTo(app, { what: 'list item', label, key, marker: '[›▌]' });
}

async function moveTo(
  app: Rendered,
  { what, label, key, marker }: { what: string; label: string; key: string; marker: string },
): Promise<string> {
  const target = new RegExp(`${EDGE}${marker} ${escapeRegExp(label)}\\*?(?:\\s|│|$)`, 'm');
  const markedRows = (frame: string) =>
    stripVTControlCharacters(frame)
      .split('\n')
      .filter((line) => new RegExp(`${EDGE}${marker} `).test(line))
      .join('\n');
  let frame = app.lastFrame() ?? '';
  for (let presses = 0; ; presses++) {
    if (target.test(stripVTControlCharacters(frame))) return frame;
    if (presses === MAX_PRESSES) {
      throw new Error(`no ${what} "${label}" after ${MAX_PRESSES} presses; last frame:\n${frame}`);
    }
    const before = markedRows(frame);
    await app.press(key);
    frame = await waitForFrame(app, (f) => markedRows(f) !== before, 2_000).catch(() => {
      throw new Error(`no ${what} "${label}": the cursor stopped moving; last frame:\n${app.lastFrame() ?? ''}`);
    });
  }
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
