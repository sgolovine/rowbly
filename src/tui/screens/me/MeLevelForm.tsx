import { applyGlobalMe, setGlobalMe } from '../../../services';
import { Form, Modal } from '../../components';
import { useActivate, useRowblyContext, useServices, useToast } from '../../hooks';

/** Global Me in the Home Config, or this Data Root's local Me in Local State. */
export type MeLevel = 'global' | 'local';

const TITLES: Record<MeLevel, string> = { global: 'Me › Global', local: 'Me › This Data Root' };

/** Edits one level of Me in a Modal: a handle, or nothing to clear it. */
export function MeLevelForm({
  level,
  handle,
  home,
  onDone,
}: {
  level: MeLevel;
  handle: string | null;
  home: string;
  onDone(): void;
}) {
  const services = useServices();
  const ctx = useRowblyContext();
  const toast = useToast();
  const activate = useActivate();
  return (
    <Modal title={TITLES[level]} hints={[{ key: 'esc', description: 'cancel' }]} onClose={onDone}>
      <Form
        fields={[{ name: 'handle', label: 'Handle (empty clears it)', kind: 'text' }]}
        initialValues={{ handle: handle ?? '' }}
        onSubmit={async (values) => {
          const next = String(values.handle ?? '').trim() || null;
          if (level === 'global') {
            const saved = await setGlobalMe(home, next);
            if (ctx) applyGlobalMe(ctx, saved);
          } else {
            // Saving sets Me on the context in place, falling back to global Me when cleared.
            await services.context.setMe(next);
          }
          // Activating a copy shows the new Me in the header too.
          if (ctx) activate({ ...ctx });
          onDone();
          toast.push('info', message(level, next, ctx?.me ?? null));
        }}
      />
    </Modal>
  );
}

function message(level: MeLevel, handle: string | null, me: string | null): string {
  const where = level === 'global' ? 'global Me' : 'the local Me';
  if (handle === null) return me ? `Cleared ${where}; you are ${me}` : `Cleared ${where}`;
  if (level === 'global' && me !== handle) return `Global Me is ${handle}; this Data Root's local Me is ${me}`;
  return level === 'global' ? `You are ${handle}` : `You are ${handle} in this Data Root`;
}
