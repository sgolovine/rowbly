import { homedir } from 'node:os';
import { Box, Text, useInput } from 'ink';
import { useContext, useState } from 'react';
import { DataRootNotFoundError } from '../../core';
import { type KnownDataRootChoice, knownDataRoots, missingLast, openKnownDataRoot } from '../../services';
import { ConfirmDialog, Loading, MissingDataRootModal, Modal, SelectListRow } from '../components';
import { ServicesContext, ShellContext, useActivate, useAsync, useToast } from '../hooks';
import type { KeyHint } from '../keymap';
import { useRouter } from '../router';
import { theme } from '../theme';
import { DataRootList } from './DataRootList';
import { DataRootRow } from './DataRootRow';
import { dataRootName, tildePath } from './dataRootName';
import { dataRootSearchHints } from './dataRootSearch';
import { EditDataRootModal } from './EditDataRootModal';
import { RemoveDataRootModal } from './RemoveDataRootModal';

/** What a pick does: open a known Data Root, or create a new one. */
type Target = { kind: 'root'; root: KnownDataRootChoice } | { kind: 'new' };
/** A known Data Root's entry being edited or removed, or a missing one that was picked. */
type Change = { kind: 'edit' | 'remove' | 'missing'; root: KnownDataRootChoice };

const CLOSE: KeyHint = { key: 'esc', description: 'close' };
const NEW: KeyHint = { key: 'n', description: 'new Data Root' };
/** With a known Data Root highlighted rather than **+ New Data Root**, which shows its own `n`. */
const ROOT_KEYS: readonly KeyHint[] = [
  { key: 'e', description: 'edit' },
  { key: 'd', description: 'delete' },
];
/** The keys the switcher acts on while the search is not focused; the others start it. */
const ACTION_KEYS = new Set(['n', 'e', 'd']);

/**
 * The known Data Roots of the Home Config, opened from the header's Data Root button or `D`. Picking
 * one opens it in place of the current one, which stays open when it cannot be read; the labels and
 * the default stay as they are. **+ New Data Root** (or `n`) opens setup, which switches to the new one.
 * Either asks first while a form holds unsaved changes. `e` edits the highlighted one's label and
 * default; `d` forgets it or deletes its folder, asking which, except the one that is open. Typing
 * any other key searches them (`DataRootList`). Missing ones are listed last, and picking one says it
 * no longer exists and offers to delete it from the list.
 */
export function DataRootSwitcher({ onClose }: { onClose(): void }) {
  const { ctx } = useContext(ServicesContext);
  const shell = useContext(ShellContext);
  const activate = useActivate();
  const router = useRouter();
  const toast = useToast();
  const home = ctx?.home ?? homedir();
  const roots = useAsync(() => knownDataRoots(home, ctx?.root ?? null), [home, ctx]);
  const choices = missingLast(roots.data ?? []);
  // Picks wait for the list: before it loads, `enter` would land on **+ New Data Root**.
  const loaded = roots.data !== undefined;
  const [confirm, setConfirm] = useState<Target | null>(null);
  const [change, setChange] = useState<Change | null>(null);
  // The Data Root being opened; picks wait until it opens or fails.
  const [opening, setOpening] = useState<KnownDataRootChoice | null>(null);
  const idle = confirm === null && opening === null && change === null;
  const picking = idle && loaded;
  // `null` while the search is not focused.
  const [query, setQuery] = useState<string | null>(null);
  const [highlighted, setHighlighted] = useState<KnownDataRootChoice | null>(null);

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
      // Gone since the list was read.
      if (err instanceof DataRootNotFoundError) setChange({ kind: 'missing', root: target.root });
      else toast.error(err);
      setOpening(null);
    }
  };
  const choose = (target: Target) => {
    if (!picking) return;
    if (target.kind === 'root' && target.root.current) onClose();
    else if (target.kind === 'root' && target.root.missing) setChange({ kind: 'missing', root: target.root });
    else if (shell.isDirty()) setConfirm(target);
    else void go(target);
  };
  const pick = (root: KnownDataRootChoice | null) => choose(root ? { kind: 'root', root } : { kind: 'new' });

  useInput(
    (input, key) => {
      // While searching, the list takes the keys and `esc` clears the search.
      if (query !== null) return;
      if (key.escape) onClose();
      else if (!picking) return;
      else if (input === 'n') choose({ kind: 'new' });
      else if (input === 'e' || input === 'd') {
        const root = highlighted;
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
    if (change.kind === 'missing') {
      return (
        <MissingDataRootModal
          root={change.root}
          name={dataRootName(change.root)}
          path={tildePath(change.root.path, home)}
          home={home}
          onDone={done}
          onCancel={() => setChange(null)}
        />
      );
    }
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
      hints={
        picking
          ? [...dataRootSearchHints(query), ...(query === null ? [...(highlighted ? ROOT_KEYS : []), NEW, CLOSE] : [])]
          : idle
            ? [CLOSE]
            : []
      }
      onClose={idle ? onClose : undefined}
    >
      <Box flexDirection="column">
        {!loaded && (roots.loading ? <Loading /> : <Text color={theme.danger}>Cannot read the known Data Roots.</Text>)}
        {loaded && (
          <DataRootList
            roots={choices}
            initial={highlighted?.path ?? choices.find((root) => root.current)?.path}
            home={home}
            active={picking}
            query={query}
            onQueryChange={setQuery}
            actionKey={(input) => ACTION_KEYS.has(input)}
            onHighlight={setHighlighted}
            onPick={pick}
            renderRow={(root, highlighted, onClick) => (
              <DataRootRow root={root} home={home} highlighted={highlighted} active={picking} onClick={onClick} />
            )}
            newRow={(highlighted, onClick) => (
              <SelectListRow highlighted={highlighted} active={picking} onClick={onClick}>
                + New Data Root{' '}
                <Text backgroundColor={theme.keycap} color={theme.inkMuted} bold={false}>
                  {' n '}
                </Text>
              </SelectListRow>
            )}
          />
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
