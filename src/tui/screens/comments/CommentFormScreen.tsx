import { Box, Text } from 'ink';
import { Form, type FormValues, Loading } from '../../components';
import { useAsync, useKeyHints, useServices, useToast } from '../../hooks';
import { FORM_KEYS } from '../../keymap';
import { useRouter } from '../../router';
import type { ScreenProps } from '../types';

/** Adds a Comment to a Story or Task (`params.target`), or edits one (`params.id`). */
export function CommentFormScreen({ params }: ScreenProps) {
  const services = useServices();
  const toast = useToast();
  const router = useRouter();
  const target = String(params.target ?? '');
  const id = params.id as string | undefined;
  const data = useAsync(
    async () => (id ? ((await services.comments.list(target)).find((c) => c.id === id) ?? null) : null),
    [services, target, id],
  );
  useKeyHints(FORM_KEYS);

  if (data.loading) return <Loading label="Loading…" />;
  const comment = data.data;
  if (id && !comment) return <Text color="red">No Comment.</Text>;

  const submit = async (values: FormValues) => {
    const body = String(values.body ?? '').trim();
    if (comment) {
      await services.comments.update(target, comment.id, body);
      toast.push('info', 'Updated Comment');
    } else {
      await services.comments.add(target, body);
      toast.push('info', 'Added Comment');
    }
    router.pop();
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
