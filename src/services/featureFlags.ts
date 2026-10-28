import { NotFoundError, ValidationError } from '../core';
import type { Repositories } from '../storage';
import type { OperationRunner } from './plugins/runtime';
import type { FeatureFlagDefinition, FeatureFlagsService } from './types';

/** Add experimental features here; each key has one name, description and default. */
export const FEATURE_FLAGS: Readonly<Record<string, FeatureFlagDefinition>> = {};

export function createFeatureFlagsService(repos: Repositories, ops: OperationRunner): FeatureFlagsService {
  function definition(key: string): FeatureFlagDefinition {
    if (!Object.hasOwn(FEATURE_FLAGS, key)) {
      throw new NotFoundError(`Experimental feature "${key}" not found`, { hint: 'see `rowbly feature-flags list`' });
    }
    return FEATURE_FLAGS[key] as FeatureFlagDefinition;
  }

  return {
    async list() {
      const config = await repos.rootConfig.get();
      return Object.entries(FEATURE_FLAGS).map(([key, flag]) => ({
        ...flag,
        key,
        enabled: config.featureFlags?.[key] ?? flag.enabled,
      }));
    },
    async isEnabled(key) {
      const flag = definition(key);
      return (await repos.rootConfig.get()).featureFlags?.[key] ?? flag.enabled;
    },
    set: (key, enabled, opts = {}) =>
      ops.run('feature-flags.set', { key, enabled, ...opts }, async (changes) => {
        const flag = definition(key);
        if (typeof enabled !== 'boolean') throw new ValidationError('Experimental feature value must be true or false');
        await changes.updateRootConfig((config) => ({
          ...config,
          featureFlags: { ...config.featureFlags, [key]: enabled },
        }));
        return { ...flag, key, enabled };
      }),
  };
}
