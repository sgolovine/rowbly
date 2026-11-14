import { type Key, useInput } from "ink";
import { type Dispatch, type SetStateAction, useContext, useMemo, useState } from "react";
import { PANEL_FRAME_HEIGHT, PANEL_FRAME_WIDTH, useCovered } from "../../../components/index.js";
import {
  type Layout,
  type SectionShell,
  ShellContext,
  sectionShell,
  useEscape,
  useIsActive,
  useKeyCapture,
  useLayout,
  useReportHints,
} from "../../../hooks/index.js";
import { type KeyHint, moveDelta } from "../../../keymap.js";
import { SECTION_NAV_WIDTH } from "../section-nav/index.js";
import type { SettingsGroup, SettingsSection } from "../settings-sections.js";

/** The region that has the focus: the section list or the section. */
type Focus = "nav" | "section";

/** The description of a section: one row and one blank row under it. */
const DESCRIPTION_HEIGHT = 2;

/** The column between the section list and the section, as in the main window. */
export const PANEL_GAP = 1;

/** The inputs of the Settings body. */
interface SettingsBodyInput {
  readonly groups: readonly SettingsGroup[];
  /** The id of a section that opens with the focus. */
  readonly initialSection: string | undefined;
  readonly onClose: () => void;
  readonly onHints: (hints: readonly KeyHint[]) => void;
}

/** What the keys of the Settings body read and change. */
interface BodyEnv {
  readonly sections: readonly SettingsSection[];
  readonly selected: number;
  readonly focus: Focus;
  readonly childShell: SectionShell;
  readonly setFocus: Dispatch<SetStateAction<Focus>>;
  readonly setSelectedId: Dispatch<SetStateAction<string | undefined>>;
  readonly onClose: () => void;
}

/** The state of the Settings body for one render. */
interface SettingsBodyModel {
  readonly active: boolean;
  /** True when no task on top of the section has the keys. */
  readonly keysOwn: boolean;
  readonly focus: Focus;
  readonly section: SettingsSection | undefined;
  readonly childShell: SectionShell;
  /** The area inside the frame of the section, under its description. */
  readonly sectionLayout: Layout;
  readonly layout: Layout;
  readonly setFocus: Dispatch<SetStateAction<Focus>>;
  readonly openSection: (id: string) => void;
}

/**
 * The keys of the region in focus. In a section, the keys of the section come first. A section that takes
 * `esc` itself, for example a page inside the section, gives its own `esc` hint, and `tab` does not leave it.
 */
function bodyHints(focus: Focus, sectionHints: readonly KeyHint[]): readonly KeyHint[] {
  if (focus === "nav") {
    return [
      { key: "↑/↓", description: "section" },
      { key: "enter", description: "open section" },
      { key: "esc", description: "close" },
    ];
  }

  const sectionEscape = sectionHints.find((hint) => hint.key === "esc");
  const own = sectionHints.filter((hint) => hint.key !== "esc" && hint.key !== "tab");

  // While the section takes `esc`, it also keeps `tab`: see `handleSectionKey`.
  if (sectionEscape) {
    return [...own, sectionEscape];
  }

  return [
    ...own,
    { key: "tab", description: "sections", secondary: true },
    { key: "esc", description: "back to sections" },
  ];
}

/** The section list and the gap after it, the frame of the section, and the description above it. */
function sectionArea(width: number, height: number | undefined): Layout {
  return {
    width: Math.max(20, width - SECTION_NAV_WIDTH - PANEL_GAP - PANEL_FRAME_WIDTH),
    height: height === undefined ? undefined : Math.max(1, height - PANEL_FRAME_HEIGHT - DESCRIPTION_HEIGHT),
  };
}

/** `esc` in the list closes Settings. A section that takes `esc` itself gets it first. */
function escapeBody(env: BodyEnv): void {
  if (env.focus === "nav") {
    env.onClose();

    return;
  }

  if (!env.childShell.holdsEscape()) {
    env.setFocus("nav");
  }
}

function handleSectionKey(env: BodyEnv, key: Key): void {
  if (key.tab && !env.childShell.holdsEscape()) {
    env.setFocus("nav");
  }
}

/** The arrows move in the list and wrap at the ends. `tab`, `enter` or `→` opens the section. */
function handleBodyKey(env: BodyEnv, input: string, key: Key): void {
  const delta = moveDelta(input, key);
  const count = env.sections.length;

  if (env.focus === "section") {
    handleSectionKey(env, key);

    return;
  }

  if (delta) {
    env.setSelectedId(env.sections[(env.selected + delta + count) % count]?.id);

    return;
  }

  if (key.tab || key.return || key.rightArrow) {
    env.setFocus("section");
  }
}

function openSection(env: BodyEnv, id: string): void {
  env.setSelectedId(id);
  env.setFocus("section");
}

/** The state, the keys and the hints of the Settings body. */
export function useSettingsBody({ groups, initialSection, onClose, onHints }: SettingsBodyInput): SettingsBodyModel {
  const shell = useContext(ShellContext);
  const active = useIsActive();
  const covered = useCovered();
  const layout = useLayout();
  const sections = groups.flatMap((group) => group.sections);
  const opened = sections.some((s) => s.id === initialSection);
  const [selectedId, setSelectedId] = useState(opened ? initialSection : sections[0]?.id);
  const [focus, setFocus] = useState<Focus>(opened ? "section" : "nav");
  const [sectionHints, setSectionHints] = useState<readonly KeyHint[]>([]);
  // The section declares its keys as a screen does; they come here, not to the footer of the shell.
  const childShell = useMemo(() => sectionShell(shell, setSectionHints), [shell]);

  const selected = Math.max(
    0,
    sections.findIndex((s) => s.id === selectedId),
  );
  const keysOwn = active && !covered;
  const env: BodyEnv = { sections, selected, focus, childShell, setFocus, setSelectedId, onClose };
  const hints = bodyHints(focus, sectionHints);

  useKeyCapture(active, { text: false, escape: true });
  // A task on top of the section, or a section that takes `esc` itself, gets the `esc`.
  useEscape(keysOwn, () => escapeBody(env));
  useInput((input, key) => handleBodyKey(env, input, key), { isActive: keysOwn });
  useReportHints(onHints, hints);

  const sectionLayout = useMemo(() => sectionArea(layout.width, layout.height), [layout.width, layout.height]);

  return {
    active,
    keysOwn,
    focus,
    section: sections[selected],
    childShell,
    sectionLayout,
    layout,
    setFocus,
    openSection: (id) => openSection(env, id),
  };
}
