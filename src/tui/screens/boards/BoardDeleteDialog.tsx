import { useState } from 'react';
import { ConflictError } from '../../../core';
import type { BoardConfig } from '../../../schemas';
import { ConfirmDialog } from '../../components';
import { useServices, useToast } from '../../hooks';

/**
 * Why `--force` would delete `board` after `err`, or `undefined` when it would not: the Board still
 * has Stories, or a Plugin guard that `--force` gets past (`details.canForce`, UI-01) refused it.
 * Any other refusal is final, so it never offers force.
 */
function forceReason(err: unknown, board: BoardConfig): string | undefined {
  if (!(err instanceof ConflictError)) return undefined;
  if (typeof err.details.stories === 'number') return `${board.name} has ${err.details.stories} Stories.`;
  if (err.details.canForce === true) return `${err.message}.`;
  return undefined;
}

/**
 * Asks before deleting `board`, then deletes it. A Board that still has Stories, or that a Plugin
 * guard `--force` gets past refused, asks again before deleting it with everything in it. Any other
 * refusal shows as an error toast. `onClose` reports whether the Board was deleted; cancelling
 * deletes nothing.
 */
export function BoardDeleteDialog({ board, onClose }: { board: BoardConfig; onClose(deleted: boolean): void }) {
  const services = useServices();
  const toast = useToast();
  const [reason, setReason] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  const remove = async (force: boolean) => {
    if (busy) return;
    setBusy(true);
    try {
      await services.boards.remove(board.id, { force });
      toast.push('info', `Deleted ${board.name}`);
      onClose(true);
    } catch (err) {
      const next = force ? undefined : forceReason(err, board);
      setBusy(false);
      if (next) setReason(next);
      else {
        toast.error(err);
        onClose(false);
      }
    }
  };

  return reason === undefined ? (
    <ConfirmDialog
      key="delete"
      message={`Delete Board ${board.name} (${board.id})?`}
      confirmLabel="Delete"
      cancelLabel="Cancel"
      destructive
      isActive={!busy}
      onConfirm={() => void remove(false)}
      onCancel={() => onClose(false)}
    />
  ) : (
    <ConfirmDialog
      key="force"
      message={`${reason} Delete the Board with all its Stories and Plugin files?`}
      confirmLabel="Delete all"
      cancelLabel="Cancel"
      destructive
      isActive={!busy}
      onConfirm={() => void remove(true)}
      onCancel={() => onClose(false)}
    />
  );
}
