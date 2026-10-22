import { homedir } from 'node:os';
import { Box, Text, useInput } from 'ink';
import { useContext, useEffect, useState } from 'react';
import { type KnownDataRootChoice, knownDataRoots, openKnownDataRoot } from '../../services';
import { ConfirmDialog, Loading, Modal, SelectListRow } from '../components';
import { ServicesContext, ShellContext, useActivate, useAsync, useCursor, useToast } from '../hooks';
import type { KeyHint } from '../keymap';
import { useRouter } from '../router';
import { theme } from '../theme';
import { DataRootRow } from './DataRootRow';
import { dataRootName } from './dataRootName';
import { EditDataRootModal } from './EditDataRootModal';
import { RemoveDataRootModal } from './RemoveDataRootModal';

/** What a pick does: open a known Data Root, or create a new one. */
type Target = { kind: 'root'; root: KnownDataRootChoice } | { kind: 'new' };
/** A known Data Root's entry being edited or removed. */
type Change = { kind: 'edit' | 'remove'; root: KnownDataRootChoice };

const CLOSE: KeyHint = { key: 'esc', description: 'close' };
const NEW_HINTS: readonly KeyHint[] = [
  { key: '↑/↓', description: 'select' },
  { key: 'enter', description: 'open' },
  { key: 'n', description: 'new Data Root' },
  CLOSE,
];
/** With a known Data Root highlighted rather than **+ New Data Root**, which shows its own `n`. */
const ROOT_HINTS: readonly KeyHint[] = [
  ...NEW_HINTS.slice(0, 2),
  { key: 'e', description: 'edit' },
  { key: 'd', description: 'delete' },
  ...NEW_HINTS.slice(2),
];

/**
 * The known Data Roots of the Home Config, opened from the header's Data Root button or `D`. Picking
 * one opens it in place of the current one, which stays open when it cannot be read; the labels and
 * the default stay as they are. **+ New Data Root** (or `n`) opens setup, which switches to the new one.
 * Either asks first while a form holds unsaved changes. `e` edits the highlighted one's label and
 * default; `d` forgets it or deletes its folder, asking which, except the one that is open.
 */
export function DataRootSwitcher({ onClose }: { onClose(): void }) {
  const { ctx } = useContext(ServicesContext);
  const shell = useContext(ShellContext);
  const activate = useActivate();
  const router = useRouter();
  const toast = useToast();
  const home = ctx?.home ?? homedir();
  const roots = useAsync(() => knownDataRoots(home, ctx?.root ?? null), [home, ctx]);
  const choices = roots.data ?? [];
  // Picks wait for the list: before it loads, `enter` would land on **+ New Data Root**.
  const loaded = roots.data !== undefined;
  const [confirm, setConfirm] = useState<Target | null>(null);
  const [change, setChange] = useState<Change | null>(null);
  // The Data Root being opened; picks wait until it opens or fails.
  const [opening, setOpening] = useState<KnownDataRootChoice | null>(null);
  const idle = confirm === null && opening === null && change === null;
  const picking = idle && loaded;
  const [cursor, setCursor] = useCursor(choices.length + 1, picking);

  const current = choices.findIndex((root) => root.current);
  useEffect(() => {
    if (current >= 0) setCursor(current);
  }, [current, setCursor]);

  const go = async (target: Target) => {
    setConfirm(null);
    if (target.kind === 'new') {
      onClose();
      router.push('setup', { title: 'New Data Root' });
      return;
    }
    setOpening(target.root);
    try {
      const next = await openKnownDataRoot({
        path: target.root.path,
        home,
        cwd: process.cwd(),
        warn: (message) => toast.push('warning', message),
      });
      // On success the app opens the new Data Root and this modal goes with the old one's screens.
      if (!(await activate(next))) setOpening(null);
    } catch (err) {
      toast.error(err);
      setOpening(null);
    }
  };
  const choose = (target: Target) => {
    if (!picking) return;
    if (target.kind === 'root' && target.root.current) onClose();
    else if (shell.isDirty()) setConfirm(target);
    else void go(target);
  };
  const pick = (index: number) => {
    const root = choices[index];
    choose(root ? { kind: 'root', root } : { kind: 'new' });
  };

  useInput(
    (input, key) => {
      if (key.escape) onClose();
      else if (!picking) return;
      else if (key.return) pick(cursor);
      else if (input === 'n') choose({ kind: 'new' });
      else if (input === 'e' || input === 'd') {
        const root = choices[cursor];
        if (!root) return;
        if (input === 'e') setChange({ kind: 'edit', root });
        else if (root.current) toast.push('warning', 'Open another Data Root before deleting this one');
        else setChange({ kind: 'remove', root });
      }
    },
    { isActive: idle },
  );

  if (change) {
    const done = () => {
      setChange(null);
      roots.reload();
    };
    const Change = change.kind === 'edit' ? EditDataRootModal : RemoveDataRootModal;
    return <Change root={change.root} home={home} onDone={done} onCancel={() => setChange(null)} />;
  }
  if (confirm) {
    return (
      <Modal title="Data Roots" size="dialog" onClose={() => setConfirm(null)}>
        <ConfirmDialog
          message={
            confirm.kind === 'new'
              ? 'Create a new Data Root and discard unsaved changes?'
              : `Open ${dataRootName(confirm.root)} and discard unsaved changes?`
          }
          confirmLabel="Discard"
          cancelLabel="Keep editing"
          destructive
          onConfirm={() => void go(confirm)}
          onCancel={() => setConfirm(null)}
        />
      </Modal>
    );
  }
  return (
    <Modal
      title="Data Roots"
      hints={picking ? (cursor < choices.length ? ROOT_HINTS : NEW_HINTS) : idle ? [CLOSE] : []}
      onClose={idle ? onClose : undefined}
    >
      <Box flexDirection="column">
        {!loaded && (roots.loading ? <Loading /> : <Text color={theme.danger}>Cannot read the known Data Roots.</Text>)}
        {choices.map((root, i) => (
          <DataRootRow
            key={root.path}
            root={root}
            home={home}
            highlighted={i === cursor}
            active={picking}
            onClick={picking ? () => pick(i) : undefined}
          />
        ))}
        {loaded && (
          <SelectListRow
            highlighted={cursor === choices.length}
            active={picking}
            onClick={picking ? () => pick(choices.length) : undefined}
          >
            + New Data Root{' '}
            <Text backgroundColor={theme.keycap} color={theme.inkMuted} bold={false}>
              {' n '}
            </Text>
          </SelectListRow>
        )}
        {opening && (
          <Box marginTop={1}>
            <Loading label={`Opening ${dataRootName(opening)}…`} />
          </Box>
        )}
      </Box>
    </Modal>
  );
}
