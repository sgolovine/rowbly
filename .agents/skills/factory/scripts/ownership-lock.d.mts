export interface Owner {
  version: 1;
  token: string;
  pid: number;
  hostname: string;
  startedAt: string;
  processIdentity?: string;
}
export type OwnerProbe = (owner: Owner) => Promise<"alive" | "dead" | "uncertain">;
export function processIdentity(pid: number): Promise<string | undefined>;
export function validOwner(owner: unknown): owner is Owner;
export function newOwner(): Promise<Owner>;
export const probeOwner: OwnerProbe;
export function readOwner(path: string): Promise<Owner | undefined>;
export function withLifecycleGuard<T>(path: string, action: () => Promise<T>, waitMs?: number): Promise<T>;
export function acquireOwner(path: string, guard: string, owner: Owner, probe?: OwnerProbe, waitMs?: number): Promise<{ acquired: boolean; owner: Owner }>;
export function releaseOwner(path: string, guard: string, token: string, waitMs?: number): Promise<boolean>;
