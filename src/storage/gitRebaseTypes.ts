import type { GitReplayStep } from './gitRebaseBridge';
import type { GitDataSource, GitReconciled } from './gitSync';

/** Private storage/service boundary for this fixed replay, never a Plugin capability. */
export interface GitRebaseHistory {
  old: GitDataSource;
  upstream: GitDataSource;
  nodes: readonly { id: string; parents: readonly string[]; base?: string }[];
  read(id: string): Promise<GitDataSource>;
  contains(ancestor: string, descendant: string): Promise<boolean>;
}
export interface GitReplayResult extends GitReconciled {
  repairs: number;
}
export interface GitReplayData {
  replay(step: GitReplayStep, current: GitDataSource): Promise<GitReplayResult>;
  finish(current: GitDataSource, pending: GitDataSource): Promise<GitReplayResult>;
}
