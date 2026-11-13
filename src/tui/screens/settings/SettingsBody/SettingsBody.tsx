import { Box, Text, useInput } from "ink";
import { useContext, useEffect, useMemo, useState } from "react";
import type { ServiceContext } from "../../../../services/workspace/workspace.js";
import { PANEL_FRAME_HEIGHT, PANEL_FRAME_WIDTH, Panel, ScrollBody, useCovered } from "../../../components/index.js";
import {
  ActiveContext,
  LayoutContext,
  ScreenDepthContext,
  ShellContext,
  sectionShell,
  useEscape,
  useIsActive,
  useKeyCapture,
  useLayout,
} from "../../../hooks/index.js";
import { type KeyHint, moveDelta } from "../../../keymap.js";
import { theme } from "../../../theme.js";
import { SECTION_NAV_WIDTH, SectionNav } from "../SectionNav/index.js";
import type { SettingsGroup } from "../settingsSections.js";

type Focus = "nav" | "section";

/** The description of a section: one row and one blank row under it. */
const DESCRIPTION_HEIGHT = 2;

/** The column between the section list and the section, as in the main window. */
const PANEL_GAP = 1;

/**
 * The inside of the Settings Modal. Only one of the two regions has the focus: the section list, or the
 * section. `enter`, `tab` or `→` opens the selected section, and `tab` or `esc` goes back to the list.
 * `esc` in the list closes Settings. While a section has a Form or a dialog open on top, the keys are
 * the keys of that task.
 */
export function SettingsBody({
  ctx,
  groups,
  section: initialSection,
  onChange,
  onClose,
  onHints,
}: {
  ctx: ServiceContext;
  groups: readonly SettingsGroup[];
  /** The id of a section that opens with the focus, for example `ai` from the Factory controls. */
  section?: string;
  onChange(): void;
  onClose(): void;
  /** The keys of the region in focus, for the hint strip of the Modal. */
  onHints(hints: readonly KeyHint[]): void;
}) {
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
  const section = sections[selected];
  const keysOwn = active && !covered;

  useKeyCapture(active, { text: false, escape: true });
  // A task on top of the section, or a section that takes `esc` itself, gets the `esc`.
  useEscape(keysOwn, () => {
    if (focus === "nav") onClose();
    else if (!childShell.holdsEscape()) setFocus("nav");
  });
  useInput(
    (input, key) => {
      if (focus === "section") {
        if (key.tab && !childShell.holdsEscape()) setFocus("nav");
        return;
      }
      const delta = moveDelta(input, key);
      if (delta) setSelectedId(sections[(selected + delta + sections.length) % sections.length]?.id);
      else if (key.tab || key.return || key.rightArrow) setFocus("section");
    },
    { isActive: keysOwn },
  );

  const hints: readonly KeyHint[] =
    focus === "nav"
      ? [
          { key: "↑/↓", description: "section" },
          { key: "enter", description: "open section" },
          { key: "esc", description: "close" },
        ]
      : [
          ...sectionHints.filter((hint) => hint.key !== "esc" && hint.key !== "tab"),
          { key: "tab", description: "sections", secondary: true },
          { key: "esc", description: "back to sections" },
        ];
  const hintsKey = JSON.stringify(hints);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `hintsKey` stands in for `hints`, which is new on each render.
  useEffect(() => onHints(hints), [hintsKey, onHints]);

  // The section list and the gap after it, the frame of the section, and the description above it.
  const sectionLayout = useMemo(
    () => ({
      width: Math.max(20, layout.width - SECTION_NAV_WIDTH - PANEL_GAP - PANEL_FRAME_WIDTH),
      height:
        layout.height === undefined ? undefined : Math.max(1, layout.height - PANEL_FRAME_HEIGHT - DESCRIPTION_HEIGHT),
    }),
    [layout.width, layout.height],
  );
  const Section = section?.Component;
  return (
    <Box height={layout.height} columnGap={PANEL_GAP}>
      <SectionNav
        groups={groups}
        selected={section?.id ?? ""}
        clickable={keysOwn}
        focused={keysOwn && focus === "nav"}
        height={layout.height}
        onFocus={keysOwn && focus === "section" ? () => setFocus("nav") : undefined}
        onSelect={(id) => {
          setSelectedId(id);
          setFocus("section");
        }}
      />
      <Panel
        title={section?.label ?? "Settings"}
        focused={keysOwn && focus === "section"}
        // A click in the section while the list has the focus moves the focus there, so its rows take clicks.
        onClick={keysOwn && focus === "nav" ? () => setFocus("section") : undefined}
        flexGrow={1}
        flexShrink={1}
        height={layout.height}
        overflow="hidden"
      >
        <Box flexShrink={0} marginBottom={1}>
          <Text color={theme.inkFaint} wrap="truncate-end">
            {section?.description ?? "No settings."}
          </Text>
        </Box>
        <ShellContext.Provider value={childShell}>
          <ScreenDepthContext.Provider value={0}>
            <ActiveContext.Provider value={active && focus === "section"}>
              <LayoutContext.Provider value={sectionLayout}>
                <ScrollBody height={sectionLayout.height}>
                  {Section && section && <Section key={section.id} ctx={ctx} onChange={onChange} />}
                </ScrollBody>
              </LayoutContext.Provider>
            </ActiveContext.Provider>
          </ScreenDepthContext.Provider>
        </ShellContext.Provider>
      </Panel>
    </Box>
  );
}
