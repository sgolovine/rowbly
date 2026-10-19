// The Plugin test harness (DX-15, TEST-01): runs Plugins against a real, isolated Data Root, through
// the real pipeline and storage, with a fixed clock and fixed ids. A Plugin's tests import only this
// module and `plugin-api`. It is a separate entry from `plugin-api` because it wires core (the
// program's reserved names, storage, every service), which a Plugin never reaches at run time; no
// production module imports it (test/plugins/testingHarnessBuild.test.ts checks the built CLI). Not
// published from the package yet (WP10B).
//
// Testing a Plugin's TUI part: render its component with `ink-testing-library`, passing the context
// from `host.context(id)` and a `PluginUi` whose methods record calls (test/plugins/
// testingHarnessTui.test.tsx runs this recipe). This covers one screen, tab or section; a test of
// navigation between screens needs the whole TUI, which is not part of the harness yet. E.g.
//
//   const host = await createPluginTestHost({ plugins: [notes] });
//   const ui = { open: vi.fn(), openStory: vi.fn(), openBoard: vi.fn(), back: vi.fn(),
//     toast: vi.fn(), error: vi.fn() };
//   const plugin = host.context<NotesSettings>('notes');
//   const { lastFrame, stdin } = render(<NotesScreen params={{}} plugin={plugin} ui={ui} />);
//   await vi.waitFor(() => expect(lastFrame()).toContain('Notes'));  // wait for its data before keys
//   stdin.write('\r');
//
// Wait for what the screen shows once its data has loaded before pressing keys: reads are async and
// a key pressed earlier may reach a screen that is still loading.

import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { reservedNames } from '../main';
import type { DataRoot } from '../schemas';
import {
  type AnyPluginDefinition,
  type AssigneeInput,
  type BoardCreateInput,
  createServices,
  failureWarning,
  loadPlugins,
  type PluginContext,
  type PluginDiagnostic,
  type PluginStatus,
  type RowblyContext,
  type Services,
  validatePluginDefinition as validateAgainst,
} from '../services';
import { createRepositories } from '../storage';
import { io } from '../storage/io';

export type { PluginDiagnostic, PluginStatus };

/**
 * Every core service, unrestricted: set up data and inspect results in a test as a user would, e.g.
 * create Stories or turn a Plugin off. A Plugin's own code gets the narrower `PluginContext`
 * (`host.context(id)`), never these.
 */
export type PluginTestServices = Services;

export interface PluginTestHostOptions {
  /** The Plugins to load and turn on, in the order they run. */
  plugins: readonly AnyPluginDefinition[];
  /** Data Root settings by Plugin id, e.g. `{ epics: { requireEpic: true } }`. */
  settings?: Readonly<Record<string, Record<string, unknown>>>;
  /** The Boards to create, before any Plugin is on. Default: Board `web` (`WEB`). */
  boards?: readonly BoardCreateInput[];
  /** The Assignee roster. Default: none. */
  assignees?: readonly AssigneeInput[];
  /** The clock. Default: always `2026-01-01T00:00:00.000Z`. */
  now?: () => Date;
  /** The id generator. Default: `id000001`, `id000002`, … */
  newId?: () => string;
  /** Me's handle. Default: no one. */
  me?: string | null;
}

export interface PluginTestHost {
  /** The Data Root, a folder of its own under the system temp folder. */
  root: DataRoot;
  /** Testing only: every core service over the loaded Plugins. */
  services: PluginTestServices;
  /** Every warning so far: Plugins that failed to load, then `warn` calls and reaction failures. */
  warnings: string[];
  /** Each Plugin's status: on, off or failed to load (with `reason`). */
  status(): PluginStatus[];
  /**
   * The context Plugin `id` gets in its commands, screens and Actions. `S` is its settings type, as
   * its own code declares it (`host.context<NotesSettings>('notes')`); it is not checked.
   */
  context<S = Record<string, unknown>>(id: string): PluginContext<S>;
  /** Removes the Data Root. Call it when the test finishes. */
  dispose(): Promise<void>;
}

/** The instant the default clock always shows. */
export const TEST_NOW = '2026-01-01T00:00:00.000Z';

/**
 * Creates a Data Root with the given Boards and Assignees, turns `plugins` on there, and loads them
 * as Rowbly does: a Plugin that fails to load is skipped and reported in `warnings` and `status()`.
 */
export async function createPluginTestHost(options: PluginTestHostOptions): Promise<PluginTestHost> {
  const dir = join(tmpdir(), `rowbly-plugin-test-${randomUUID()}`);
  await io.mkdir(dir);
  const dispose = () => io.rm(dir);
  try {
    const root: DataRoot = { path: join(dir, '.rowbly'), kind: 'local' };
    const warnings: string[] = [];
    let ids = 0;
    const base: RowblyContext = {
      root,
      local: { version: 1 },
      me: options.me ?? null,
      now: options.now ?? (() => new Date(TEST_NOW)),
      newId: options.newId ?? (() => `id${String(++ids).padStart(6, '0')}`),
      warn: (message) => warnings.push(message),
    };

    // Set up without Plugins, so that their hooks see only what the test does.
    const core = createServices(base);
    await core.setup.init({ root });
    for (const assignee of options.assignees ?? []) await core.assignees.add(assignee);
    for (const board of options.boards ?? [{ id: 'web', name: 'Web', keyPrefix: 'WEB' }]) {
      await core.boards.create(board);
    }
    const config = createRepositories(root).rootConfig;
    const plugins = Object.fromEntries(
      options.plugins.map(({ id }) => [id, { ...options.settings?.[id], enabled: true }]),
    );
    await config.put({ ...(await config.get()), plugins });

    const host = await loadPlugins({ root, registry: options.plugins, reserved: reservedNames() });
    warnings.push(...host.failures().map(failureWarning));
    const services = createServices({ ...base, plugins: host });
    return {
      root,
      services,
      warnings,
      status: () => host.status(),
      context: <S>(id: string) => services.plugins.context(id) as PluginContext<S>,
      dispose,
    };
  } catch (err) {
    await dispose();
    throw err;
  }
}

/**
 * The problems Rowbly would reject `definition` for when it loads, checked against the names core
 * uses: its id, options, Action keys, replacements and hooks. Empty when it is fine (DX-32).
 */
export function validatePluginDefinition(definition: AnyPluginDefinition): PluginDiagnostic[] {
  return validateAgainst(definition, reservedNames());
}
