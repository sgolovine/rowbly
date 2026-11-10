import { Box, Text, useInput } from "ink";
import { useState } from "react";
import { bundledSkills, listSkills } from "../../../../services/skill/skill.js";
import { Button, Loading, SelectList } from "../../../components/index.js";
import { ActiveContext, useAsync, useIsActive, useKeyHints, useLayout } from "../../../hooks/index.js";
import { theme } from "../../../theme.js";
import { SkillActionModal } from "../SkillActionModal/index.js";
import type { SettingsSectionProps } from "../settingsSections.js";

/** The bundled skills and the copies that the Project tracks. */
export function SkillsSection({ ctx, onChange }: SettingsSectionProps) {
  const active = useIsActive();
  const layout = useLayout();
  const [mode, setMode] = useState<"install" | "remove" | null>(null);
  const [selected, setSelected] = useState<string>();
  const [filtering, setFiltering] = useState(false);
  const list = useAsync(async () => {
    const [bundled, tracked] = await Promise.all([bundledSkills(ctx), listSkills(ctx)]);
    return { bundled: bundled.names, tracked };
  }, [ctx]);
  const names = [...new Set([...(list.data?.bundled ?? []), ...(list.data?.tracked.map((s) => s.name) ?? [])])].sort();
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
  useKeyHints(
    idle
      ? [
          { key: "↑/↓", description: "select" },
          { key: "/", description: "filter" },
          ...(canInstall ? [{ key: "i", description: "install" }] : []),
          ...(canRemove ? [{ key: "d", description: "uninstall" }] : []),
          { key: "r", description: "reload" },
        ]
      : [],
  );
  useInput(
    (input) => {
      if (input === "i" && canInstall) setMode("install");
      else if (input === "d" && canRemove) setMode("remove");
      else if (input === "r") list.reload();
    },
    { isActive: idle && !filtering },
  );

  if (list.loading) return <Loading label="Loading skills…" />;
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
              limit={Math.max(1, Math.min(5, (layout.height ?? 24) - 8))}
              onHighlight={(item) => setSelected(item?.value)}
              onSelect={(item) => setSelected(item.value)}
              onFilteringChange={setFiltering}
            />
          </ActiveContext.Provider>
          {current && (
            <Box flexDirection="column">
              <Text color={theme.ink} bold>
                {current}
              </Text>
              {!canInstall && <Text color={theme.inkFaint}>No longer bundled. Install is unavailable.</Text>}
              {tracked?.harnesses.map((h) => (
                <Box key={h.harness} flexDirection="column">
                  <Text color={theme.inkMuted}>
                    {h.harness} · {h.installed ? "installed" : "missing"}
                  </Text>
                  <Text color={theme.inkFaint} wrap="wrap">
                    {h.path}
                  </Text>
                </Box>
              ))}
              {!canRemove && <Text color={theme.inkFaint}>Not installed.</Text>}
            </Box>
          )}
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
          onSaved={() => {
            setMode(null);
            list.reload();
            onChange();
          }}
        />
      )}
    </Box>
  );
}
