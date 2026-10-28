import { homedir } from 'node:os';
import { Box, Text, useInput } from 'ink';
import { useContext, useRef, useState } from 'react';
import { openKnownDataRoot } from '../../../services';
import { canonicalDataRootPath, readHomeConfig, updateHomeConfig } from '../../../storage';
import { ScrollBody } from '../../components';
import { ActiveContext, ServicesContext, useIsActive, useKeyHints, useLayout, useToast } from '../../hooks';
import { onboardingRoute } from '../../onboardingRoute';
import { useRouter } from '../../router';
import { theme } from '../../theme';
import type { ScreenProps } from '../types';
import { GlobalOnboarding } from './GlobalOnboarding';
import { RootOnboarding } from './RootOnboarding';

/** Completion and explicit skip share the same durable flag; errors leave the flow retryable. */
export function OnboardingScreen({ params }: ScreenProps) {
  const { ctx, services, activate } = useContext(ServicesContext);
  const toast = useToast();
  const router = useRouter();
  const active = useIsActive();
  const layout = useLayout();
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const global = params.level === 'global';
  const home = typeof params.home === 'string' ? params.home : (ctx?.home ?? homedir());
  const finish = async () => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    try {
      if (global) await updateHomeConfig(home, (config) => ({ ...config, onboardingComplete: true }));
      else if (services) await services.config.updateRootConfig({ onboardingComplete: true });
      if (params.reopen) router.pop();
      else if (global) {
        if (!ctx && activate) {
          const roots = (await readHomeConfig(home)).dataRoots ?? [];
          const root = roots.find((entry) => entry.default) ?? roots[0];
          if (root) {
            await activate(
              await openKnownDataRoot({
                path: await canonicalDataRootPath(root.path, home),
                home,
                cwd: process.cwd(),
                warn: (message) => toast.push('warning', message),
              }),
            );
            return;
          }
        }
        const next = await onboardingRoute(ctx, services);
        router.reset(next.screen, next.params);
      } else router.reset('home');
    } catch (err) {
      toast.error(err);
    } finally {
      running.current = false;
      setBusy(false);
    }
  };
  useKeyHints([{ key: 'ctrl+k', description: 'skip onboarding' }]);
  useInput(
    (input, key) => {
      if (key.ctrl && input === 'k') void finish();
    },
    { isActive: active && !busy },
  );
  return (
    <ScrollBody height={layout.height}>
      <Box flexDirection="column" gap={1}>
        <Text color={theme.inkFaint}>
          ctrl+k skips onboarding and saves completion. Reopen it from Settings › Onboarding.
        </Text>
        {busy && <Text color={theme.inkMuted}>Saving onboarding…</Text>}
        <ActiveContext.Provider value={active && !busy}>
          {global ? (
            <GlobalOnboarding home={home} onDone={finish} />
          ) : services ? (
            <RootOnboarding onDone={finish} />
          ) : null}
        </ActiveContext.Provider>
      </Box>
    </ScrollBody>
  );
}
