import { homedir } from 'node:os';
import type { RowblyContext, Services } from '../services';
import { readHomeConfig } from '../storage';
import type { Route } from './router';

/** Global onboarding precedes shared Data Root onboarding; callers resolve missing paths first. */
export async function onboardingRoute(ctx: RowblyContext | null, services: Services | null): Promise<Route> {
  const home = ctx?.home ?? homedir();
  if (!(await readHomeConfig(home)).onboardingComplete) {
    return { screen: 'onboarding', params: { level: 'global', home, title: 'Welcome to Rowbly' } };
  }
  if (services && !(await services.config.global()).config.onboardingComplete) {
    return { screen: 'onboarding', params: { level: 'root', title: 'Data Root onboarding' } };
  }
  return { screen: ctx ? 'home' : 'setup', params: {} };
}
