import type { PolicyState } from "./supervisor-policy.mjs";
export function statePath(root: string): string;
export function readState(root: string): Promise<PolicyState>;
export function writeState(root: string, input: PolicyState): Promise<PolicyState>;
export function withStateLock<T>(root: string, action: () => Promise<T>): Promise<T>;
export function resetState(root: string): Promise<{ moved: string | null; attempts: number }>;
