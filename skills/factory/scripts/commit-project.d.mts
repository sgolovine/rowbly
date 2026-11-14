export function lockPath(root: string): Promise<string>;
export interface CommitResult {
  status: "committed" | "clean" | "held" | "conflict" | "no-git" | "failed";
  commit?: string;
  paths?: string[];
  held?: string[];
  detail?: string;
  lock?: string;
}
export function commitProject(root: string, options?: { message?: string; author?: string; lock?: string; lockWaitSeconds?: number }): Promise<CommitResult>;
