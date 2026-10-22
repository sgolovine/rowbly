import { homedir } from 'node:os';
import { Box, Text } from 'ink';
import { useState } from 'react';
import type { DataRoot } from '../../../schemas';
import { type SetupLocation, setupTarget } from '../../../services/setup';
import { useEscape, useIsActive, useKeyCapture, useKeyHints, useRowblyContext } from '../../hooks';
import type { ScreenProps } from '../types';
import { CustomPathForm } from './CustomPathForm';
import { InitForm } from './InitForm';
import { LocationPicker } from './LocationPicker';

/** The `setup` route's params; `cwd` and `home` override the process values (for tests). */
export interface SetupParams {
  /** Skip the location choice: `here`, `home`, or `custom` to go straight to the path. */
  location?: SetupLocation;
  /** Keep the current Data Root and go back afterwards, instead of opening the app on the new one. */
  stay?: boolean;
  cwd?: string;
  home?: string;
}

type Step = { kind: 'pick' } | { kind: 'path' } | { kind: 'form'; root: DataRoot };

function firstStep(location: SetupLocation | undefined, at: { cwd: string; home: string }): Step {
  if (location === 'custom') return { kind: 'path' };
  if (location) return { kind: 'form', root: setupTarget(location, at) };
  return { kind: 'pick' };
}

/**
 * Creates a Data Root, as `rowbly init` does: the first-run screen when no Data Root is found, and
 * what other screens open (`router.push('setup', params)`, see `SetupParams`) to create another.
 * It asks where (this directory, the home folder or a custom path), then for the label, the default
 * choice, the first Board and global Me.
 */
export function SetupScreen({ params }: ScreenProps) {
  const p = params as SetupParams;
  const at = { cwd: p.cwd ?? process.cwd(), home: p.home ?? homedir() };
  const location = p.location === 'here' || p.location === 'home' || p.location === 'custom' ? p.location : undefined;
  const [step, setStep] = useState<Step>(() => firstStep(location, at));
  const active = useIsActive();
  // Opened from a running Data Root, it creates another one rather than greeting a first run.
  const another = useRowblyContext() !== null;
  // Without a preset location, `esc` from the path or the form goes back to the choice.
  const canGoBack = location === undefined && step.kind !== 'pick';
  useKeyCapture(active && canGoBack, { escape: true, text: false });
  useEscape(active && canGoBack, () => setStep({ kind: 'pick' }));
  // The form shows its own keys (`ctrl+s save`, `enter` next field), so only the picker adds one.
  useKeyHints(
    step.kind === 'pick'
      ? [{ key: 'enter', description: 'choose' }]
      : canGoBack
        ? [{ key: 'esc', description: 'back' }]
        : [],
  );

  if (step.kind === 'pick') {
    return (
      <Box flexDirection="column" gap={1}>
        <Text bold>{another ? 'New Data Root' : 'Welcome to Rowbly'}</Text>
        <Text>
          {another
            ? 'Where should Rowbly create the new Data Root?'
            : 'No Data Root found. Where should Rowbly keep its data?'}
        </Text>
        <LocationPicker {...at} onChoose={(root) => setStep(root ? { kind: 'form', root } : { kind: 'path' })} />
      </Box>
    );
  }
  if (step.kind === 'path') return <CustomPathForm {...at} onChoose={(root) => setStep({ kind: 'form', root })} />;
  return <InitForm root={step.root} {...at} stay={p.stay === true} />;
}
