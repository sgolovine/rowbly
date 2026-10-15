import type { PluginScreenProps } from '../../plugin-api';
import { Form, Loading, Text, useAsync } from '../../plugin-api/tui';
import { createSpec, editSpec, getSpec, parseSpecFormParams, titledText } from './specs';

export function SpecFormScreen({ params, plugin, ui }: PluginScreenProps<Record<string, unknown>>) {
  const loaded = useAsync(async () => {
    const form = parseSpecFormParams(params);
    return { form, spec: form.create ? null : await getSpec(plugin, form.target) };
  }, [plugin, params.board, params.story, params.slug, params.create]);
  if (loaded.loading) return <Loading />;
  if (!loaded.data) return <Text color="red">Could not load Spec.</Text>;
  const { form, spec } = loaded.data;
  const newBoardSpec = form.create && form.story === undefined;
  return (
    <Form
      fields={[
        ...(newBoardSpec ? [{ name: 'slug', label: 'Slug', kind: 'text' as const, required: true }] : []),
        ...(form.create ? [{ name: 'title', label: 'Title', kind: 'text' as const, required: true }] : []),
        { name: 'text', label: 'Spec', kind: 'multiline' },
      ]}
      initialValues={{ text: spec?.text ?? '' }}
      onSubmit={async (values) => {
        if (form.create) {
          const target =
            form.story === undefined
              ? { board: form.board, slug: String(values.slug) }
              : { board: form.board, story: form.story };
          await createSpec(plugin, target, titledText(String(values.text), String(values.title)));
          ui.toast('Created Spec');
        } else {
          await editSpec(plugin, form.target, String(values.text));
          ui.toast('Edited Spec');
        }
        ui.back();
      }}
    />
  );
}
