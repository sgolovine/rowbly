import { Box, Text, useInput } from "ink";
import { useState } from "react";
import { getProject, updateProject } from "../../../../services/project/project.js";
import { Button, DetailView, FormModal, Loading } from "../../../components/index.js";
import { useAsync, useIsActive, useKeyHints, useToast } from "../../../hooks/index.js";
import { theme } from "../../../theme.js";
import type { SettingsSectionProps } from "../settingsSections.js";

/**
 * The name and the key of the project. `e` edits the name in a Form. The key is the prefix of every
 * Story file, so it does not change here.
 */
export function ProjectSection({ ctx, onChange }: SettingsSectionProps) {
  const active = useIsActive();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const project = useAsync(() => getProject(ctx), [ctx]);
  const idle = active && !editing && project.data !== undefined;

  useKeyHints(idle ? [{ key: "e", description: "edit name" }] : []);
  useInput(
    (input) => {
      if (input === "e") setEditing(true);
    },
    { isActive: idle },
  );

  if (!project.data) return project.loading ? <Loading label="Loading the project…" /> : null;
  return (
    <Box flexDirection="column" gap={1}>
      <DetailView
        rows={[
          { label: "Name", value: project.data.projectName },
          { label: "Key", value: project.data.projectKey },
          { label: "Folder", value: project.data.root },
        ]}
      />
      <Text color={theme.inkFaint}>The key is the prefix of each Story, for example {project.data.projectKey}-1.</Text>
      <Box>
        <Button label="Edit name" keyName="e" onClick={() => setEditing(true)} clickable={idle} compact />
      </Box>
      {editing && (
        <FormModal
          title="Edit Project"
          fields={[{ name: "name", label: "Name", kind: "text", required: true }]}
          initialValues={{ name: project.data.projectName }}
          onSubmit={async (values) => {
            const saved = await updateProject({ name: String(values.name ?? "") }, ctx);
            toast.push("info", `Renamed the project to ${saved.projectName}`);
            setEditing(false);
            project.reload();
            onChange();
          }}
          onClose={() => setEditing(false)}
        />
      )}
    </Box>
  );
}
