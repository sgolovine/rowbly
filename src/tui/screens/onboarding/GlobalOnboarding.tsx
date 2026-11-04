import { Box, Text, useInput } from 'ink';
import { useContext, useState } from 'react';
import { applyGlobalMe, registerExistingDataRoot, setGlobalMe } from '../../../services';
import { readHomeConfig } from '../../../storage';
import { Form, Loading, SelectList } from '../../components';
import {
  ShellContext,
  useAsync,
  useEscape,
  useIsActive,
  useKeyCapture,
  useKeyHints,
  useRowblyContext,
} from '../../hooks';
import { theme } from '../../theme';
import { OnboardingNav } from './OnboardingNav';
import { NAV_HINT } from './onboardingSteps';

const STEPS = ['welcome', 'me', 'roots'] as const;

/** Global Me and existing Data Roots only; creating a Data Root belongs to setup. */
export function GlobalOnboarding({ home, onDone }: { home: string; onDone(): Promise<void> }) {
  const ctx = useRowblyContext();
  const shell = useContext(ShellContext);
  const [step, setStep] = useState<(typeof STEPS)[number] | 'register'>('welcome');
  const saved = useAsync(() => readHomeConfig(home), [home]);
  const [registered, setRegistered] = useState<string | null>(null);
  const [meResult, setMeResult] = useState<string | null>(null);
  const active = useIsActive();
  // The register form is a sub-step of Data Roots: esc returns to it, and Back and Next are hidden.
  const index = step === 'register' ? -1 : STEPS.indexOf(step);
  const back = () => {
    const prev = STEPS[index - 1];
    if (prev) setStep(prev);
  };
  const next = () => {
    const following = STEPS[index + 1];
    if (following) setStep(following);
    else void onDone();
  };
  useKeyCapture(active && step === 'register', { text: false, escape: true });
  useEscape(active && step === 'register', () => setStep('roots'));
  useInput(
    (_input, key) => {
      // A text field being edited keeps its keys.
      if (!key.shift || shell.captured().text) return;
      if (key.leftArrow) back();
      else if (key.rightArrow) next();
    },
    { isActive: active && index >= 0 && saved.data !== undefined },
  );
  useKeyHints(
    step === 'roots'
      ? [{ key: '↑/↓', description: 'select' }, { key: 'enter', description: 'choose' }, NAV_HINT]
      : step === 'register'
        ? []
        : [NAV_HINT],
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
        </>
      ) : step === 'me' ? (
        <>
          <Text color={theme.inkMuted}>
            Global Me is the creator of your Stories. A Data Root’s local Me still takes precedence. Leave empty to keep
            your handle.
          </Text>
          {meResult && <Text color={theme.accent}>✓ {meResult}</Text>}
          <Form
            initialValues={{ me: saved.data.me ?? '' }}
            fields={[{ name: 'me', label: 'Handle', kind: 'text' }]}
            submitLabel="save"
            onSubmit={async (values) => {
              const handle = String(values.me ?? '').trim();
              if (!handle) {
                setMeResult('Kept your handle.');
                return;
              }
              const me = await setGlobalMe(home, handle);
              if (ctx) applyGlobalMe(ctx, me);
              // Back to Me shows the saved handle.
              saved.reload();
              setMeResult(`Saved ${handle} as global Me.`);
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
              const path = await registerExistingDataRoot(home, String(values.path), {
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
            items={[{ value: 'register', label: 'Register an existing Data Root' }]}
            onSelect={() => setStep('register')}
          />
        </>
      )}
      {index >= 0 && (
        <OnboardingNav
          onBack={back}
          onNext={next}
          onSkip={() => void onDone()}
          first={index === 0}
          last={index === STEPS.length - 1}
          clickable={active}
        />
      )}
    </Box>
  );
}
