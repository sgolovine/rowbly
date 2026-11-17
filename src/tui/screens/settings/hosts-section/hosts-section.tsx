import { Box, Text } from "ink";
import type { FactorySettings } from "../../../../services/factory-settings/factory-settings.js";
import { Button, FormModal, type FormValues } from "../../../components/index.js";
import { theme } from "../../../theme.js";
import { AiSettingCard } from "../ai-setting-card/index.js";
import { HostActionsBar } from "../host-actions-bar/index.js";
import { HostCheckItems } from "../host-check-items/index.js";
import { HostList } from "../host-list/index.js";
import type { SettingsSectionProps } from "../settings-sections.js";
import {
  type HostsEnv,
  openAddHost,
  runCheck,
  saveNewHost,
  savePlacement,
  saveWorkers,
  toggleEnabled,
  toggleProject,
} from "./hosts-actions.js";
import { ADD_HOST_COMMAND, type HostsTask, placementText, taskForm } from "./hosts-view.js";
import { useHostsSection } from "./use-hosts-section.js";

/** The props of `HostsTaskView`. */
interface HostsTaskViewProps {
  readonly task: NonNullable<HostsTask>;
  readonly env: HostsEnv;
  readonly settings: FactorySettings | undefined;
}

/** Saves the values of the form of a task. */
function submitTask(env: HostsEnv, task: NonNullable<HostsTask>, values: FormValues): Promise<void> {
  if (task.kind === "placement") {
    return savePlacement(env, values);
  }

  return task.kind === "workers" ? saveWorkers(env, task.row, values) : saveNewHost(env, values);
}

/** The form on top of the Hosts section: the placement, the worker limit of one host, or a new host. */
function HostsTaskView({ task, env, settings }: HostsTaskViewProps) {
  const form = taskForm(task, settings);

  return (
    <FormModal
      title={form.title}
      fields={form.fields}
      initialValues={form.initial}
      submitOnEnter={task.kind !== "add"}
      onSubmit={(values) => submitTask(env, task, values)}
      onClose={() => env.setTask(null)}
    >
      <Text color={theme.inkFaint} wrap="wrap">
        {form.note}
      </Text>
    </FormModal>
  );
}

/** The text without hosts. `a` adds a host; the CLI command also does. */
function NoHosts() {
  return (
    <Box flexDirection="column">
      <Text color={theme.inkFaint}>No worker hosts.</Text>
      <Text color={theme.inkFaint} wrap="wrap">
        To add a worker host, push a. You can also run {ADD_HOST_COMMAND}
      </Text>
    </Box>
  );
}

/**
 * The worker hosts and the placement of the factory. `p` edits the placement and `a` adds a host. On the selected
 * host, `u` turns it on or off for this Project, `e` for all Projects, `w` edits the worker limit and `c` runs the
 * check. The section calls only services. Only the add, the use and the check open SSH.
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
        <Box marginTop={1}>
          <Button label="Add host" keyName="a" compact clickable={idle} onClick={() => openAddHost(env)} />
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
