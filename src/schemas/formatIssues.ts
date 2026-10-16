/**
 * `path: message; …`, one entry per issue, for error messages (CQ-01). An issue at the top level uses
 * `fallback` as its path. Each caller keeps its own error class and wording around it.
 */
export function formatIssues(
  issues: readonly { path: readonly PropertyKey[]; message: string }[],
  fallback: string,
): string {
  return issues.map((issue) => `${issue.path.map(String).join('.') || fallback}: ${issue.message}`).join('; ');
}
