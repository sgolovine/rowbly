import { Box, Text, useInput } from "ink";
import { getProject, updateProject } from "../../../../services/project/project.js";
import { Loading, Switch } from "../../../components/index.js";
import { useAsync, useIsActive, useKeyHints, useToast } from "../../../hooks/index.js";
import { theme } from "../../../theme.js";
import type { SettingsSectionProps } from "../settingsSections.js";

/**
 * Turns Specs on or off for the project. `space`, `enter` or a click on the Switch toggles it. While Specs
 * are on, an open Story has a Specs tab.
 */
export function SpecsSection({ ctx, onChange }: SettingsSectionProps) {
  const active = useIsActive();
  const toast = useToast();
  const project = useAsync(() => getProject(ctx), [ctx]);
  const idle = active && project.data !== undefined;
  const on = project.data?.features?.specs === true;

  const toggle = () => {
    updateProject({ features: { specs: !on } }, ctx).then(
      () => {
        toast.push("info", `Specs ${on ? "off" : "on"}`);
        project.reload();
        onChange();
      },
      (err: unknown) => toast.error(err),
    );
  };

  useKeyHints(idle ? [{ key: "space", description: on ? "turn off" : "turn on" }] : []);
  useInput(
    (input, key) => {
      if (input === " " || key.return) toggle();
    },
    { isActive: idle },
  );

  if (!project.data) return project.loading ? <Loading label="Loading the project…" /> : null;
  return (
    <Box flexDirection="column" gap={1}>
      <Box gap={2}>
        <Text color={theme.inkMuted}>Specs</Text>
        <Switch on={on} onLabel="Enabled" offLabel="Disabled" onChange={toggle} clickable={idle} />
      </Box>
      <Text color={theme.inkFaint}>
        A spec is a Markdown document in .rowbly/specs/, linked to one or more Stories. While Specs are on, an open
        Story has a Specs tab.
      </Text>
    </Box>
  );
}
