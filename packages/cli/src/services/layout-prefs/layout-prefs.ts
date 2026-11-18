import { rcPath, readRc, type UserRc, writeRc } from "../user-rc/user-rc.js";
import type { ServiceContext } from "../workspace/workspace.js";

/** The key of `~/.rowblyrc.json` that holds the sizes of the TUI sidebars. */
const LAYOUT_KEY = "layout";

/** The sizes that the user dragged in the TUI. A size that is not here has its default. */
export interface LayoutPrefs {
  /** The width of the Stage sidebar, in columns. */
  readonly sidebarWidth?: number;
  /** The height of the tag sidebar, in rows. */
  readonly tagsHeight?: number;
  /** The width of the Story sidebar, in columns. */
  readonly storyWidth?: number;
}

const SIZE_KEYS = ["sidebarWidth", "tagsHeight", "storyWidth"] as const;

type SizeKey = (typeof SIZE_KEYS)[number];

type LayoutRecord = Readonly<Record<string, unknown>>;

function isRecord(value: unknown): value is LayoutRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSize(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

/** The stored `layout` object. A value that is not an object is no object. */
function storedLayout(rc: UserRc): LayoutRecord {
  const layout = rc[LAYOUT_KEY];

  return isRecord(layout) ? layout : {};
}

/** The valid sizes of `layout`. A size that is not a positive integer goes out. */
function validSizes(layout: LayoutRecord): LayoutPrefs {
  return Object.fromEntries(
    SIZE_KEYS.flatMap((key) => (isSize(layout[key]) ? [[key, layout[key]] as const] : [])),
  ) as LayoutPrefs;
}

/** The valid sizes of `prefs`, so that a write never stores a bad size. */
function givenSizes(prefs: LayoutPrefs): LayoutPrefs {
  return validSizes(prefs as LayoutRecord);
}

function changesLayout(layout: LayoutRecord, sizes: LayoutPrefs): boolean {
  return Object.entries(sizes).some(([key, value]) => layout[key as SizeKey] !== value);
}

/**
 * Reads the saved sidebar sizes. A missing file, no `layout` key or a bad size gives no value for that size. A file
 * that Rowbly cannot read throws.
 */
export async function readLayoutPrefs(ctx: ServiceContext = {}): Promise<LayoutPrefs> {
  return validSizes(storedLayout(await readRc(rcPath(ctx))));
}

/**
 * Saves the sizes of `prefs`, and keeps the other saved sizes and all other keys of the file. It writes nothing when
 * no size changes, and never writes a file that Rowbly cannot read.
 */
export async function writeLayoutPrefs(prefs: LayoutPrefs, ctx: ServiceContext = {}): Promise<void> {
  const file = rcPath(ctx);
  const rc = await readRc(file);
  const layout = storedLayout(rc);
  const sizes = givenSizes(prefs);

  if (!changesLayout(layout, sizes)) {
    return;
  }

  await writeRc(file, { ...rc, [LAYOUT_KEY]: { ...layout, ...sizes } });
}
