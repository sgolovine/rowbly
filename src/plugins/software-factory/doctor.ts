import type { PluginDoctor, PluginFinding } from '../../plugin-api';
import { PLUGIN_ID, readPrompt, resolvePath, Settings } from './stagePrompts';

/**
 * `MISSING_PROMPT` (reported as `SOFTWARE_FACTORY_MISSING_PROMPT`): a Stage Prompt that is turned on
 * at either level, but whose path does not resolve or whose file is gone or cannot be read (a
 * symbolic link is not followed). An agent reads it as off.
 */
export const doctor: PluginDoctor<Settings> = {
  async check({ data, plugin }) {
    const levels = [
      { board: undefined, raw: data.config?.plugins?.[PLUGIN_ID], path: 'rowbly.config.json' },
      ...data.boards.map((b) => ({
        board: b.id,
        raw: b.plugins?.[PLUGIN_ID],
        path: `boards/${b.id}/board.config.json`,
      })),
    ];
    const findings: PluginFinding[] = [];
    for (const { board, raw, path } of levels) {
      // An unreadable Board bag is the core PLUGIN_DATA_INVALID finding.
      const parsed = Settings.safeParse(raw ?? {});
      if (!parsed.success) continue;
      for (const [stage, entry] of Object.entries(parsed.data.stagePrompts)) {
        if (!entry.enabled) continue;
        const level = board ? 'board' : 'global';
        const name = resolvePath(level, board, entry.path);
        const text =
          name === null ? null : await readPrompt(() => plugin.files.read(board ? { board } : 'dataRoot', name));
        if (text !== null) continue;
        const where = board ? `on Board ${board}` : 'at the global level';
        findings.push({
          code: 'MISSING_PROMPT',
          severity: 'warning',
          path,
          message:
            name === null
              ? `Stage Prompt "${stage}" ${where} is on, but its path ${entry.path ? `"${entry.path}" is outside the Plugin folder` : 'is not set'}`
              : `Stage Prompt "${stage}" ${where} is on, but its file ${entry.path} is missing or cannot be read`,
          details: { stage, ...(board ? { board } : {}), promptPath: entry.path ?? null },
        });
      }
    }
    return findings;
  },
};
