import type { PluginScreenProps } from '../../plugin-api';
import { Form, Loading, useAsync } from '../../plugin-api/tui';
import { getSpec, type SpecTarget, saveSpec, titledText } from './specs';

export function SpecFormScreen({ params, plugin, ui }: PluginScreenProps<Record<string, unknown>>) {
  const target = params as unknown as SpecTarget;
  const create = params.create === true;
  const spec = useAsync(
    async () => (create ? null : getSpec(plugin, target)),
    [plugin, create, target.board, target.story, target.slug],
  );
  if (spec.loading) return <Loading />;
  if (spec.error) return null;
  return (
    <Form
      fields={[
        ...(create && !target.story ? [{ name: 'slug', label: 'Slug', kind: 'text' as const, required: true }] : []),
        ...(create ? [{ name: 'title', label: 'Title', kind: 'text' as const, required: true }] : []),
        { name: 'text', label: 'Spec', kind: 'multiline' },
      ]}
      initialValues={{ text: spec.data?.text ?? '' }}
      onSubmit={async (values) => {
        await saveSpec(
          plugin,
          { ...target, slug: target.story ? undefined : create ? String(values.slug) : target.slug },
          titledText(String(values.text), create ? String(values.title) : undefined),
          create,
        );
        ui.toast(create ? 'Created Spec' : 'Edited Spec');
        ui.back();
      }}
    />
  );
}
