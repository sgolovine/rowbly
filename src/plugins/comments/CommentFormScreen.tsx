import { type PluginScreenProps, UsageError } from '../../plugin-api';
import { Box, FORM_KEYS, Form, type FormValues, Loading, Text, useAsync, useKeyHints } from '../../plugin-api/tui';
import { addComment, editComment, getComment } from './comments';

/** Adds a Comment to a Story or Task (`params.target`), or edits one (`params.id`). */
export function CommentFormScreen({ params, plugin, ui }: PluginScreenProps<Record<string, unknown>>) {
  // Malformed params fail the load, so a bad route never adds or edits by accident (CQ-134).
  const data = useAsync(async () => {
    const { target, id } = formParams(params);
    return { target, comment: id === undefined ? null : await getComment(plugin, target, id) };
  }, [plugin, params.target, params.id]);
  useKeyHints(FORM_KEYS);

  if (data.loading) return <Loading label="Loading…" />;
  if (!data.data) {
    const reason = data.error instanceof Error ? data.error.message : String(data.error);
    return <Text color="red">Could not open the Comment form: {reason}</Text>;
  }
  const { target, comment } = data.data;

  const submit = async (values: FormValues) => {
    // The body is saved as typed, as the CLI saves it; the service refuses a whitespace-only one (UI-02).
    const body = typeof values.body === 'string' ? values.body : '';
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

/** A nonempty string `target`, and an `id` that is absent or a string; anything else is a `UsageError`. */
function formParams(params: Record<string, unknown>): { target: string; id?: string } {
  const { target, id } = params;
  if (typeof target !== 'string' || target === '') {
    throw new UsageError('the Comment form needs a Story Key or Task id as its target');
  }
  if (id !== undefined && typeof id !== 'string') throw new UsageError('the Comment id must be a string');
  return { target, id };
}
