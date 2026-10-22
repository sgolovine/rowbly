// Me at two levels (ADR-0032): global Me in the Home Config, and a local Me in a Data Root's Local
// State that replaces it there.
import { isSlug, ValidationError } from '../core';
import type { LocalState, Slug } from '../schemas';
import { readHomeConfig, updateHomeConfig } from '../storage';
import type { RowblyContext } from './types';

/** Where Me comes from: Local State (`local`), the Home Config (`global`), or nowhere. */
export type MeSource = 'local' | 'global' | null;

/** What `whoami` reports: Me, where it comes from, and both levels. */
export interface Identity {
  me: Slug | null;
  source: MeSource;
  global: Slug | null;
  /** Local State's Me; `null` also when there is no Data Root. */
  local: Slug | null;
}

/** Me: the local Me, else global Me, else `null`. */
export function effectiveMe(local: LocalState, globalMe: Slug | null | undefined): Slug | null {
  return local.me ?? globalMe ?? null;
}

/** Both levels of Me and the one that wins; `local` is `null` without a Data Root. */
export function identity(local: LocalState | null, globalMe: Slug | null): Identity {
  const localMe = local?.me ?? null;
  const me = localMe ?? globalMe;
  return { me, source: localMe ? 'local' : globalMe ? 'global' : null, global: globalMe, local: localMe };
}

/** Global Me from the Home Config in `home`; throws when the Home Config cannot be read. */
export async function readGlobalMe(home: string): Promise<Slug | null> {
  return (await readHomeConfig(home)).me ?? null;
}

/** Sets global Me in the Home Config in `home` (`null` removes it), keeping its other keys. */
export async function setGlobalMe(home: string, handle: Slug | null): Promise<Slug | null> {
  if (handle !== null && !isSlug(handle)) {
    throw new ValidationError(`invalid handle "${handle}": must be a lower-kebab-case slug`);
  }
  const saved = await updateHomeConfig(home, ({ me: _me, ...rest }) =>
    handle === null ? rest : { ...rest, me: handle },
  );
  return saved.me ?? null;
}

/** Makes `globalMe` the context's global Me; Me follows unless a local Me replaces it. */
export function applyGlobalMe(ctx: RowblyContext, globalMe: Slug | null): void {
  ctx.globalMe = globalMe;
  ctx.me = effectiveMe(ctx.local, globalMe);
}
