import { Box, Text } from "ink";
import type { ServiceContext } from "../../../../services/workspace/workspace.js";
import { Panel, ScrollBody } from "../../../components/index.js";
import { ActiveContext, LayoutContext, ScreenDepthContext, ShellContext } from "../../../hooks/index.js";
import type { KeyHint } from "../../../keymap.js";
import { theme } from "../../../theme.js";
import { SectionNav } from "../section-nav/index.js";
import type { SettingsGroup } from "../settings-sections.js";
import { PANEL_GAP, useSettingsBody } from "./use-settings-body.js";

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
  const model = useSettingsBody({ groups, initialSection, onClose, onHints });

  const { active, keysOwn, focus, section, childShell, sectionLayout, layout, setFocus } = model;
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
        onSelect={model.openSection}
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
