import { Box, Text } from "ink";
import type { FactorySettings } from "../../../../services/factory-settings/factory-settings.js";
import { FormModal } from "../../../components/index.js";
import { theme } from "../../../theme.js";
import { AiSettingCard } from "../ai-setting-card/index.js";
import { HostActionsBar } from "../host-actions-bar/index.js";
import { HostCheckItems } from "../host-check-items/index.js";
import { HostList } from "../host-list/index.js";
import type { SettingsSectionProps } from "../settings-sections.js";
import { type HostsEnv, runCheck, savePlacement, saveWorkers, toggleEnabled, toggleProject } from "./hosts-actions.js";
import { ADD_HOST_COMMAND, type HostsTask, placementForm, placementText, workersForm } from "./hosts-view.js";
import { useHostsSection } from "./use-hosts-section.js";

/** The props of `HostsTaskView`. */
interface HostsTaskViewProps {
  readonly task: NonNullable<HostsTask>;
  readonly env: HostsEnv;
  readonly settings: FactorySettings | undefined;
}

/** The form on top of the Hosts section: the placement or the worker limit of one host. */
function HostsTaskView({ task, env, settings }: HostsTaskViewProps) {
  const form = task.kind === "placement" ? placementForm(settings) : workersForm(task.row);

  return (
    <FormModal
      title={form.title}
      fields={[form.field]}
      initialValues={{ [form.field.name]: form.initial }}
      submitOnEnter
      onSubmit={(values) =>
        task.kind === "placement" ? savePlacement(env, values) : saveWorkers(env, task.row, values)
      }
      onClose={() => env.setTask(null)}
    >
      <Text color={theme.inkFaint} wrap="wrap">
        {form.note}
      </Text>
    </FormModal>
  );
}

/** The text without hosts. The TUI does not add hosts; the CLI does. */
function NoHosts() {
  return (
    <Box flexDirection="column">
      <Text color={theme.inkFaint}>No worker hosts.</Text>
      <Text color={theme.inkFaint} wrap="wrap">
        To add a worker host, run {ADD_HOST_COMMAND}
      </Text>
    </Box>
  );
}

/**
 * The worker hosts and the placement of the factory. `p` edits the placement. On the selected host, `u` turns it on
 * or off for this Project, `e` for all Projects, `w` edits the worker limit and `c` runs the check. The section calls
 * only services. Only the use and the check open SSH.
 */
export function HostsSection({ ctx, onChange }: SettingsSectionProps) {
  const { env, task, cursor, setCursor, check, idle } = useHostsSection({ ctx, onChange });

  const settings = env.settings.data;
  const rows = env.rows.data ?? [];
  const { row, busy } = env;

  return (
    <Box flexDirection="column">
      <AiSettingCard
        title="Placement"
        value={placementText(settings)}
        description="How the factory selects the machine of a new worker: the main machine or a worker host."
        action={settings ? "Edit" : undefined}
        keyName="p"
        clickable={idle}
        onEdit={() => env.setTask({ kind: "placement" })}
      />
      <Box flexDirection="column" marginTop={1} paddingX={1}>
        <Text bold color={theme.ink}>
          Worker hosts
        </Text>
        <Text color={theme.inkFaint} wrap="wrap">
          The hosts of ~/.rowblyrc.json. A host runs workers of this Project only when it is on for this Project.
        </Text>
        <Box marginTop={1} flexDirection="column">
          {rows.length > 0 ? (
            <HostList rows={rows} cursor={cursor} active={idle} busy={busy} onPick={setCursor} />
          ) : (
            <NoHosts />
          )}
        </Box>
      </Box>
      {row && (
        <HostActionsBar
          row={row}
          clickable={idle}
          busy={busy !== null}
          onToggleProject={() => toggleProject(env, row)}
          onToggleEnabled={() => toggleEnabled(env, row)}
          onWorkers={() => env.setTask({ kind: "workers", row })}
          onCheck={() => runCheck(env, row)}
        />
      )}
      {check && (
        <Box marginTop={1} paddingX={1}>
          <HostCheckItems check={check} />
        </Box>
      )}
      {task && <HostsTaskView task={task} env={env} settings={settings} />}
    </Box>
  );
}
