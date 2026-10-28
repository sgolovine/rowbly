import { Box, Text } from 'ink';
import { useState } from 'react';
import { applyGlobalMe, openKnownDataRoot, setGlobalMe, updateKnownDataRoot } from '../../../services';
import { canonicalDataRootPath, readHomeConfig } from '../../../storage';
import { Form, Loading, SelectList } from '../../components';
import { useAsync, useEscape, useIsActive, useKeyCapture, useKeyHints, useRowblyContext, useToast } from '../../hooks';
import { theme } from '../../theme';

/** Global Me and existing Data Roots only; creating a Data Root belongs to setup. */
export function GlobalOnboarding({ home, onDone }: { home: string; onDone(): Promise<void> }) {
  const ctx = useRowblyContext();
  const toast = useToast();
  const [step, setStep] = useState<'welcome' | 'me' | 'roots' | 'register'>('welcome');
  const saved = useAsync(() => readHomeConfig(home), [home]);
  const [registered, setRegistered] = useState<string | null>(null);
  const active = useIsActive();
  useKeyCapture(active && step === 'register', { text: false, escape: true });
  useEscape(active && step === 'register', () => setStep('roots'));
  useKeyHints(
    step === 'welcome' || step === 'roots'
      ? [
          { key: '↑/↓', description: 'select' },
          { key: 'enter', description: 'continue' },
        ]
      : [],
  );
  if (!saved.data)
    return saved.loading ? (
      <Loading label="Reading Home Config…" />
    ) : (
      <SelectList items={[{ value: 'retry', label: 'Retry reading Home Config' }]} onSelect={saved.reload} />
    );
  return (
    <Box flexDirection="column" gap={1}>
      <Text bold>
        {step === 'welcome' ? 'Welcome to Rowbly' : step === 'me' ? 'Your handle (Me)' : 'Your Data Roots'}
      </Text>
      {step === 'welcome' ? (
        <>
          <Text>
            Rowbly keeps Stories on Boards inside a Data Root. Set your handle and register the Data Roots you use.
          </Text>
          <Text color={theme.inkMuted}>
            These choices belong to you in ~/.rowblyrc.json. You can reopen onboarding in Settings.
          </Text>
          <SelectList items={[{ value: 'next', label: 'Get started' }]} onSelect={() => setStep('me')} />
        </>
      ) : step === 'me' ? (
        <>
          <Text color={theme.inkMuted}>
            Global Me is the creator of your Stories. A Data Root’s local Me still takes precedence. Leave empty to keep
            your handle.
          </Text>
          <Form
            initialValues={{ me: saved.data.me ?? '' }}
            fields={[{ name: 'me', label: 'Handle', kind: 'text' }]}
            submitLabel="next"
            onSubmit={async (values) => {
              const handle = String(values.me ?? '').trim();
              if (handle) {
                const me = await setGlobalMe(home, handle);
                if (ctx) applyGlobalMe(ctx, me);
              }
              setStep('roots');
            }}
          />
        </>
      ) : step === 'register' ? (
        <>
          <Text color={theme.inkMuted}>
            Register an existing Data Root folder, e.g. ~/work/.rowbly. Relative paths start at your home folder. This
            creates no Data Root.
          </Text>
          <Form
            fields={[
              { name: 'path', label: 'Data Root path', kind: 'text', required: true },
              { name: 'label', label: 'Label (optional)', kind: 'text' },
              { name: 'default', label: 'Default Data Root', kind: 'boolean' },
            ]}
            submitLabel="register"
            onSubmit={async (values) => {
              const path = await canonicalDataRootPath(String(values.path), home);
              // Validate before registration. Opening checks the config before createContext records it.
              await openKnownDataRoot({
                path,
                home,
                cwd: process.cwd(),
                warn: (message) => toast.push('warning', message),
              });
              await updateKnownDataRoot(home, path, {
                label: String(values.label ?? ''),
                default: values.default === true,
              });
              setRegistered(path);
              saved.reload();
              setStep('roots');
            }}
          />
        </>
      ) : (
        <>
          <Text color={theme.inkMuted}>
            Register existing Data Roots to find them in the switcher. A default opens from any directory. You can
            create a missing Data Root in setup.
          </Text>
          {registered && <Text>Registered {registered}</Text>}
          {(saved.data.dataRoots ?? []).map((root) => (
            <Text key={root.path}>
              {root.label ?? root.path}
              {root.default ? ' · default' : ''}
            </Text>
          ))}
          <SelectList
            items={[
              { value: 'register', label: 'Register an existing Data Root' },
              { value: 'done', label: 'Continue' },
            ]}
            onSelect={(item) => {
              if (item.value === 'register') setStep('register');
              else void onDone();
            }}
          />
        </>
      )}
    </Box>
  );
}
