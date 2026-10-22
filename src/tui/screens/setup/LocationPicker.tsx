import type { DataRoot } from '../../../schemas';
import { assertInitTarget, setupTarget } from '../../../services/setup';
import { SelectList } from '../../components';
import { useToast } from '../../hooks';

/**
 * Where to create the Data Root: this directory, the home folder, or another folder. `onChoose` gets
 * the target, checked to be free, or `null` for another folder, whose path comes next.
 */
export function LocationPicker({
  cwd,
  home,
  onChoose,
}: {
  cwd: string;
  home: string;
  onChoose(root: DataRoot | null): void;
}) {
  const toast = useToast();
  const here = setupTarget('here', { cwd, home });
  const homeRoot = setupTarget('home', { cwd, home });
  return (
    <SelectList
      items={[
        { value: 'here', label: 'This directory', description: here.path },
        { value: 'home', label: 'Home folder', description: homeRoot.path },
        { value: 'custom', label: 'Another folder', description: 'type the path of the Data Root folder' },
      ]}
      onSelect={async (item) => {
        if (item.value === 'custom') return onChoose(null);
        const target = item.value === 'home' ? homeRoot : here;
        try {
          // Refuse an existing Data Root before showing the form.
          await assertInitTarget(target);
          onChoose(target);
        } catch (err) {
          toast.error(err);
        }
      }}
    />
  );
}
