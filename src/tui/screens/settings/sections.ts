import type { BoardConfig } from '../../../schemas';
import { pluginRoute, type TuiPlugin } from '../../hooks';
import { boardsScreens } from '../boards';
import { doctorScreens } from '../doctor';
import { fieldsScreens } from '../fields';
import { meScreens } from '../me';
import { pluginsScreens } from '../plugins';
import { preferencesScreens } from '../preferences';
import { setupScreens } from '../setup';
import { stagesScreens } from '../stages';
import type { ScreenComponent, ScreenRegistry } from '../types';

/** One entry in the settings sidebar: the screen shown beside it and the params it gets. */
export interface SettingsSection {
  id: string;
  label: string;
  screen: string;
  params?: Record<string, unknown>;
}

/** A heading in the settings sidebar and the sections under it. */
export interface SettingsGroup {
  title: string;
  /** Shown dim under the title when the group has no sections. */
  empty?: string;
  sections: readonly SettingsSection[];
}

/**
 * The settings shared by every Board in the Data Root first, then those of the Board in context.
 * Without a Board in context the Board group is empty. The sections that Plugins add follow the
 * global ones.
 */
export function settingsGroups(board: BoardConfig | null, plugins: readonly TuiPlugin[] = []): SettingsGroup[] {
  const boardId = board?.id;
  return [
    {
      title: 'Global',
      sections: [
        { id: 'boards', label: 'Boards', screen: 'boards' },
        { id: 'global-stages', label: 'Stages', screen: 'stages', params: { global: true } },
        { id: 'global-fields', label: 'Fields', screen: 'fields', params: { global: true } },
        { id: 'me', label: 'Me', screen: 'me' },
        { id: 'preferences', label: 'Preferences', screen: 'preferences' },
        { id: 'doctor', label: 'Doctor', screen: 'doctor' },
        { id: 'plugins', label: 'Plugins', screen: 'plugins' },
      ],
    },
    {
      title: board ? `Board: ${board.name}` : 'Board',
      empty: 'None in context',
      sections: boardId
        ? [
            // The Board detail, which shows the effective configuration (`config show`).
            { id: 'board-config', label: 'Config', screen: 'board-detail', params: { boardId, title: 'Config' } },
            { id: 'board-stages', label: 'Stages', screen: 'stages', params: { boardId } },
            { id: 'board-fields', label: 'Fields', screen: 'fields', params: { boardId } },
          ]
        : [],
    },
    ...plugins.flatMap((plugin) => {
      const sections = (plugin.tui.settings ?? []).map((link, i) => {
        const route = pluginRoute(plugin.id, link.screen, link.params);
        return { id: `plugin:${plugin.id}:${i}`, label: link.label, ...route };
      });
      return sections.length ? [{ title: `Plugins: ${plugin.id}`, sections }] : [];
    }),
  ];
}

const SECTION_SCREENS: ScreenRegistry = {
  ...boardsScreens,
  ...stagesScreens,
  ...fieldsScreens,
  ...setupScreens,
  ...meScreens,
  ...preferencesScreens,
  ...doctorScreens,
  ...pluginsScreens,
};

export function sectionScreen(section: SettingsSection): ScreenComponent | undefined {
  return SECTION_SCREENS[section.screen];
}
