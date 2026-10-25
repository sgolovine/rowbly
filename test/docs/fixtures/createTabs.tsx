// #region create-tabs
import { type PluginStoryCreateTabProps, type PluginTui, z } from '../../../src/plugin-api';
import { Form } from '../../../src/plugin-api/tui';

const Draft = z.object({ note: z.string() });

function CreateNotes({ draft, onChange, active }: PluginStoryCreateTabProps) {
  const value = Draft.parse(draft ?? { note: '' });
  return (
    <Form
      fields={[{ name: 'note', label: 'Note', kind: 'multiline' }]}
      values={value}
      onChange={onChange}
      isActive={active}
      onSubmit={() => {}}
    />
  );
}

export const createNotesTui: PluginTui = {
  storyCreateTabs: [
    {
      label: 'Notes',
      component: CreateNotes,
      input(draft) {
        const { note } = Draft.parse(draft);
        return note ? { note } : undefined;
      },
    },
  ],
};
// #endregion
