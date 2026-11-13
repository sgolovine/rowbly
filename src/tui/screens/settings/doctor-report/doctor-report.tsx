import { Box, Text } from "ink";
import type { DoctorIssue } from "../../../../services/doctor/doctor.js";
import { Loading } from "../../../components/index.js";
import { theme } from "../../../theme.js";

/** The glyph and the colour of an issue: fixed, error or warning. */
function mark(issue: DoctorIssue): { glyph: string; color: string } {
  if (issue.fixed) {
    return { glyph: "✓", color: theme.accent };
  }

  return issue.severity === "error" ? { glyph: "✕", color: theme.danger } : { glyph: "!", color: theme.stageBoard };
}

/** The fix of an issue after its file, or nothing when the issue has no fix. */
function fixText(issue: DoctorIssue): string {
  if (!issue.fix) {
    return "";
  }

  return ` · ${issue.fixed ? "fixed" : "fix"}: ${issue.fix}`;
}

/** The props of `DoctorReportView`. */
export interface DoctorReportViewProps {
  readonly issues: readonly DoctorIssue[];
  /** False when an issue is an error. */
  readonly ok: boolean;
  /** True while the checks run again. The issues of the last run stay on screen. */
  readonly busy: boolean;
}

/** The result of the checks in one line, then each issue with its file and its fix. */
export function DoctorReportView({ issues, ok, busy }: DoctorReportViewProps) {
  return (
    <>
      {busy && <Loading label="Checking the project…" />}
      {!busy && issues.length === 0 && <Text color={theme.ink}>No problems. The files agree with the config.</Text>}
      {!busy && issues.length > 0 && (
        <Text color={ok ? theme.ink : theme.danger}>
          {ok ? "No errors." : "The project has errors."}{" "}
          <Text color={theme.inkFaint}>
            {issues.length} {issues.length === 1 ? "issue" : "issues"}, {issues.filter((i) => i.fixed).length} fixed
          </Text>
        </Text>
      )}
      {issues.length > 0 && (
        <Box flexDirection="column">
          {issues.map((issue, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: the issues of one report do not change order.
            <Box key={i} flexDirection="column" marginBottom={1}>
              <Text>
                <Text color={mark(issue).color}>{mark(issue).glyph}</Text>{" "}
                <Text color={theme.ink}>{issue.message}</Text>
              </Text>
              <Text color={theme.inkFaint}>
                {"  "}
                {issue.file}
                {fixText(issue)}
              </Text>
            </Box>
          ))}
        </Box>
      )}
    </>
  );
}
