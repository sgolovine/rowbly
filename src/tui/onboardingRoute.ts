import { homedir } from 'node:os';
import type { RowblyContext, Services } from '../services';
import { listKnownDataRoots, readHomeConfig } from '../storage';
import type { Route } from './router';

/** Choose a known Data Root before onboarding; global onboarding precedes Data Root onboarding. */
export async function onboardingRoute(ctx: RowblyContext | null, services: Services | null): Promise<Route> {
  const home = ctx?.home ?? homedir();
  if (!ctx && (await listKnownDataRoots(home)).length > 0) {
    return { screen: 'data-roots', params: { title: 'Choose a Data Root' } };
  }
  if (!(await readHomeConfig(home)).onboardingComplete) {
    return { screen: 'onboarding', params: { level: 'global', home, title: 'Welcome to Rowbly' } };
  }
  if (services && !(await services.config.global()).config.onboardingComplete) {
    return { screen: 'onboarding', params: { level: 'root', title: 'Data Root onboarding' } };
  }
  return { screen: ctx ? 'home' : 'setup', params: {} };
}
