import type { PluginScreenProps } from '../../plugin-api';
import { Box, FORM_KEYS, Form, type FormValues, Loading, Text, useAsync, useKeyHints } from '../../plugin-api/tui';
import { addComment, editComment, getComment } from './comments';

/** Adds a Comment to a Story or Task (`params.target`), or edits one (`params.id`). */
export function CommentFormScreen({ params, plugin, ui }: PluginScreenProps<Record<string, unknown>>) {
  const target = String(params.target ?? '');
  const id = params.id as string | undefined;
  const data = useAsync(async () => (id ? getComment(plugin, target, id) : null), [plugin, target, id]);
  useKeyHints(FORM_KEYS);

  if (data.loading) return <Loading label="Loading…" />;
  const comment = data.data;
  if (id && !comment) return <Text color="red">No Comment.</Text>;

  const submit = async (values: FormValues) => {
    const body = String(values.body ?? '').trim();
    if (comment) {
      await editComment(plugin, target, comment.id, body);
      ui.toast('Updated Comment');
    } else {
      await addComment(plugin, target, body);
      ui.toast('Added Comment');
    }
    ui.back();
  };

  return (
    <Box flexDirection="column" gap={1}>
      <Text bold>{comment ? `Edit Comment on ${target}` : `New Comment on ${target}`}</Text>
      <Form
        fields={[{ name: 'body', label: 'Comment', kind: 'multiline', required: true }]}
        initialValues={{ body: comment?.body ?? '' }}
        onSubmit={submit}
      />
    </Box>
  );
}
