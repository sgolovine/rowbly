import { Box, Text } from 'ink';
import { Form } from '../../components';
import { useActivate, useRowblyContext, useServices, useToast } from '../../hooks';
import { theme } from '../../theme';

/** Claims Me (`whoami`): a handle, or nothing to clear it. */
export function MeScreen() {
  const services = useServices();
  const ctx = useRowblyContext();
  const toast = useToast();
  const activate = useActivate();
  const me = ctx?.me ?? null;
  return (
    <Box flexDirection="column" gap={1}>
      <Text>Me: {me ? <Text bold>{me}</Text> : <Text color={theme.inkFaint}>not set</Text>}</Text>
      <Text color={theme.inkFaint}>
        The handle you work as: the creator of your Stories and the author of your Comments. Kept in local.json, never
        committed.
      </Text>
      {/* Keyed by Me, so the form starts again from the saved handle and is no longer dirty. */}
      <Form
        key={me ?? ''}
        fields={[{ name: 'handle', label: 'Handle (empty clears Me)', kind: 'text' }]}
        initialValues={{ handle: me ?? '' }}
        onSubmit={async (values) => {
          const handle = String(values.handle ?? '').trim() || null;
          await services.context.setMe(handle);
          // Saving sets Me on the context in place; activating a copy shows it in the header too.
          if (ctx) activate({ ...ctx });
          toast.push('info', handle ? `You are ${handle}` : 'Cleared Me');
        }}
      />
    </Box>
  );
}
