import { type PluginScreenProps, readBinaryInput, UsageError } from '../../plugin-api';
import { Box, Form, type FormValues, Text } from '../../plugin-api/tui';
import { addAttachment } from './attachments';
import { formatSize } from './formatSize';
import { MAX_ATTACHMENT_BYTES } from './model';

export function AttachmentFormScreen({ params, plugin, ui }: PluginScreenProps<unknown>) {
  const target = params.target;
  if (typeof target !== 'string' || !target) throw new UsageError('the Attachment form needs a Story Key');
  const submit = async (values: FormValues) => {
    const input = await readBinaryInput(String(values.path), MAX_ATTACHMENT_BYTES);
    const added = await addAttachment(plugin, target, input);
    ui.toast(`Attached ${added.name} (${formatSize(added.size)})`);
    ui.back();
  };
  return (
    <Box flexDirection="column" gap={1}>
      <Text bold>New Attachment on {target}</Text>
      <Form fields={[{ name: 'path', label: 'PNG file path', kind: 'text', required: true }]} onSubmit={submit} />
    </Box>
  );
}
