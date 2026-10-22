import { type PluginScreenProps, slugFromName } from '../../plugin-api';
import { Form, Loading, Text, theme, useAsync } from '../../plugin-api/tui';
import { createSpec, parseSpecFormParams, titledText } from './specs';

/** Creates a Board Spec, or a Story Spec of `params.story`; a Spec is then edited in the full-screen editor. */
export function SpecFormScreen({ params, plugin, ui }: PluginScreenProps<Record<string, unknown>>) {
  const loaded = useAsync(async () => parseSpecFormParams(params), [params.board, params.story, params.slug]);
  if (loaded.loading) return <Loading />;
  if (!loaded.data) return <Text color={theme.danger}>Could not open the Spec form.</Text>;
  const form = loaded.data;
  return (
    <Form
      fields={[
        { name: 'title', label: 'Title', kind: 'text', required: true },
        {
          name: 'slug',
          label: 'Slug',
          kind: 'text',
          required: true,
          fillFrom: { field: 'title', format: (title) => slugFromName(title) },
        },
        { name: 'text', label: 'Spec', kind: 'multiline' },
      ]}
      onSubmit={async (values) => {
        const slug = String(values.slug);
        const target =
          form.story === undefined ? { board: form.board, slug } : { board: form.board, story: form.story, slug };
        await createSpec(plugin, target, titledText(String(values.text ?? ''), String(values.title)));
        ui.toast('Created Spec');
        ui.back();
      }}
    />
  );
}
