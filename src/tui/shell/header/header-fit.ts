import type { FactoryStatus } from "../../../services/factory/factory.js";
import { factoryButtonWidth } from "../factory-button/index.js";
import { viewModeSwitchWidth } from "../view-mode-switch/index.js";

/** Below this width, the Story finder shows only its glyph, and only the Buttons that always stay remain. */
const COMPACT_WIDTH = 60;

/** The most columns the Project name takes, when there is room. */
const PROJECT_NAME_WIDTH = 24;

/** The most columns the Project name takes below `COMPACT_WIDTH`. */
const PROJECT_NAME_NARROW_WIDTH = 12;

/** The columns of the row without the Project name, with the full and with the compact Story finder. */
const ROW_WIDTH_FULL = 73;
const ROW_WIDTH_COMPACT = 51;

/** The `|` after the Factory group. */
const SEPARATOR_WIDTH = 1;

/** How the parts of the header fit in its width. */
export interface HeaderFit {
  readonly narrow: boolean;
  /** The Project name, cut to its room. */
  readonly name: string;
  /** The Story finder shows only its glyph. */
  readonly compact: boolean;
  /** The Factory Button leaves out its pending count. */
  readonly factoryShort: boolean;
  readonly factoryKey: boolean;
  readonly factoryShown: boolean;
  /** The view mode switch shows after the Factory Button. It shows only when the full header fits with it. */
  readonly switchShown: boolean;
}

/** What the fit reads: the width, the Project name and the status of the factory, when there are such parts. */
interface FitInput {
  readonly width: number;
  readonly project: string | undefined;
  readonly factory: { readonly status: FactoryStatus | undefined } | undefined;
  /** The Factory group has the view mode switch. */
  readonly viewSwitch?: boolean;
}

function cutName(name: string | undefined, width: number): string {
  return name !== undefined && name.length > width ? `${name.slice(0, width - 1)}…` : (name ?? "");
}

/** The columns of the Factory group: the Factory Button, the view mode switch when `withSwitch`, and the `|`. */
function factoryWidth(input: FitInput, withKey: boolean, short = false, withSwitch = false): number {
  const switchWidth = withSwitch ? viewModeSwitchWidth(withKey) : 0;

  return input.factory ? factoryButtonWidth(input.factory.status, withKey, short) + switchWidth + SEPARATOR_WIDTH : 0;
}

/** Whether a row of `row` columns fits next to the Project name. Without a Project, each row fits. */
function fits(input: FitInput, name: string, row: number): boolean {
  return input.project === undefined || name.length + row <= input.width;
}

/**
 * Fits the header parts in `width`. The view mode switch goes first, so that the other parts keep their room.
 * Then the Story finder becomes its glyph, the Factory Button loses its pending count, then its key cap, then
 * it goes.
 */
export function headerFit(input: FitInput): HeaderFit {
  const narrow = input.width < COMPACT_WIDTH;
  const nameWidth = narrow ? PROJECT_NAME_NARROW_WIDTH : Math.min(PROJECT_NAME_WIDTH, input.width - ROW_WIDTH_COMPACT);
  const name = cutName(input.project, nameWidth);

  const compact = narrow || !fits(input, name, ROW_WIDTH_FULL + factoryWidth(input, true));
  const factoryShort = compact && !fits(input, name, ROW_WIDTH_COMPACT + factoryWidth(input, true));
  const factoryRow = compact ? ROW_WIDTH_COMPACT : ROW_WIDTH_FULL;
  const factoryKey = fits(input, name, factoryRow + factoryWidth(input, true, factoryShort));
  const factoryShown =
    input.factory !== undefined && !narrow && fits(input, name, ROW_WIDTH_COMPACT + factoryWidth(input, false, true));
  const switchShown =
    factoryShown &&
    input.viewSwitch === true &&
    fits(input, name, ROW_WIDTH_FULL + factoryWidth(input, true, false, true));

  return { narrow, name, compact, factoryShort, factoryKey, factoryShown, switchShown };
}
