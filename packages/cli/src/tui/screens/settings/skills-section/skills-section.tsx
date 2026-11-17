import { Box, Text, useInput } from "ink";
import { useState } from "react";
import { Button, Loading, SelectList } from "../../../components/index.js";
import { ActiveContext, useAsync, useIsActive, useKeyHints, useLayout } from "../../../hooks/index.js";
import { theme } from "../../../theme.js";
import type { SettingsSectionProps } from "../settings-sections.js";
import { SkillActionModal, type SkillMode } from "../skill-action-modal/index.js";
import { SkillDetails } from "../skill-details/index.js";
import { loadSkills, type SkillsEnv, skillNames, skillSaved, skillsHints, skillsKey } from "./skills-view.js";

/** The rows of the list that fit next to the rest of the section, from one to five. */
function listLimit(height: number | undefined): number {
  return Math.max(1, Math.min(5, (height ?? 24) - 8));
}

/** The bundled skills and the copies that the Project tracks. */
export function SkillsSection({ ctx, onChange }: SettingsSectionProps) {
  const active = useIsActive();
  const layout = useLayout();
  const [mode, setMode] = useState<SkillMode | null>(null);
  const [selected, setSelected] = useState<string>();
  const [filtering, setFiltering] = useState(false);
  const list = useAsync(() => loadSkills(ctx), [ctx]);

  const names = skillNames(list.data);
  const current = selected && names.includes(selected) ? selected : names[0];
  const tracked = list.data?.tracked.find((s) => s.name === current);
  const canInstall = current !== undefined && list.data?.bundled.includes(current) === true;
  const canRemove = (tracked?.harnesses.length ?? 0) > 0;
  const idle = active && mode === null && !list.loading;
  const items = names.map((name) => ({
    value: name,
    label: name,
    description: list.data?.tracked.some((s) => s.name === name) ? "tracked" : "not installed",
  }));
  const env: SkillsEnv = { list, canInstall, canRemove, setMode, onChange };

  useKeyHints(skillsHints(idle, canInstall, canRemove));
  useInput((input) => skillsKey(env, input), { isActive: idle && !filtering });

  if (list.loading) {
    return <Loading label="Loading skills…" />;
  }

  return (
    <Box flexDirection="column" gap={1}>
      {list.error !== undefined ? (
        <Text color={theme.inkFaint}>Cannot load skills. Press r to try again.</Text>
      ) : (
        <>
          <ActiveContext.Provider value={idle}>
            <SelectList
              items={items}
              emptyText="No bundled or tracked skills."
              limit={listLimit(layout.height)}
              onHighlight={(item) => setSelected(item?.value)}
              onSelect={(item) => setSelected(item.value)}
              onFilteringChange={setFiltering}
            />
          </ActiveContext.Provider>
          {current && <SkillDetails name={current} tracked={tracked} bundled={canInstall} />}
          <Box flexWrap="wrap" gap={1}>
            {canInstall && (
              <Button label="Install" keyName="i" compact clickable={idle} onClick={() => setMode("install")} />
            )}
            {canRemove && (
              <Button
                label="Uninstall"
                keyName="d"
                compact
                destructive
                clickable={idle}
                onClick={() => setMode("remove")}
              />
            )}
          </Box>
          <Text color={theme.inkFaint}>
            Another harness can still read a retained or shared skill folder after removal.
          </Text>
        </>
      )}
      <Button label="Reload" keyName="r" compact clickable={idle} onClick={list.reload} />
      {mode && current && (
        <SkillActionModal
          ctx={ctx}
          mode={mode}
          name={current}
          tracked={tracked}
          onClose={() => setMode(null)}
          onSaved={() => skillSaved(env)}
        />
      )}
    </Box>
  );
}
