import { Box, Text, useInput } from "ink";
import { useState } from "react";
import { type DoctorIssue, doctor } from "../../../../services/doctor/doctor.js";
import { Button, Loading } from "../../../components/index.js";
import { useAsync, useIsActive, useKeyHints } from "../../../hooks/index.js";
import { theme } from "../../../theme.js";
import type { SettingsSectionProps } from "../settings-sections.js";

/** The glyph and the colour of an issue: fixed, error or warning. */
function mark(issue: DoctorIssue): { glyph: string; color: string } {
  if (issue.fixed) {
    return { glyph: "✓", color: theme.accent };
  }
  return issue.severity === "error" ? { glyph: "✕", color: theme.danger } : { glyph: "!", color: theme.stageBoard };
}

/**
 * Runs `rowbly doctor` when it opens, and shows each issue with its file and its fix. `r` runs the
 * checks again, and `f` applies the fixes that are available, as `rowbly doctor --fix` does.
 */
export function DoctorSection({ ctx, onChange }: SettingsSectionProps) {
  const active = useIsActive();
  const [run, setRun] = useState<{ fix: boolean; count: number }>({ fix: false, count: 0 });
  const report = useAsync(async () => {
    const result = await doctor({ fix: run.fix }, ctx);
    if (run.fix && result.issues.some((issue) => issue.fixed)) {
      onChange();
    }
    return result;
  }, [ctx, run]);
  const busy = report.loading;
  const fixable = report.data?.issues.some((issue) => issue.fix && !issue.fixed) ?? false;
  const check = () => setRun((r) => ({ fix: false, count: r.count + 1 }));
  const fix = () => setRun((r) => ({ fix: true, count: r.count + 1 }));

  useKeyHints(
    active && !busy
      ? [{ key: "r", description: "check again" }, ...(fixable ? [{ key: "f", description: "fix" }] : [])]
      : [],
  );
  useInput(
    (input) => {
      if (input === "r") {
        check();
      } else if (input === "f" && fixable) {
        fix();
      }
    },
    { isActive: active && !busy },
  );

  if (!report.data) {
    return busy ? <Loading label="Checking the project…" /> : null;
  }
  const { issues, ok } = report.data;
  return (
    <Box flexDirection="column" gap={1}>
      {busy ? (
        <Loading label="Checking the project…" />
      ) : issues.length === 0 ? (
        <Text color={theme.ink}>No problems. The files agree with the config.</Text>
      ) : (
        <Text color={ok ? theme.ink : theme.danger}>
          {ok ? "No errors." : "The project has errors."}{" "}
          <Text color={theme.inkFaint}>
            {issues.length} {issues.length === 1 ? "issue" : "issues"}, {issues.filter((i) => i.fixed).length} fixed
          </Text>
        </Text>
      )}
      {issues.length > 0 && (
        <Box flexDirection="column">
          {issues.map((issue, i) => {
            const { glyph, color } = mark(issue);
            return (
              // biome-ignore lint/suspicious/noArrayIndexKey: the issues of one report do not change order.
              <Box key={i} flexDirection="column" marginBottom={1}>
                <Text>
                  <Text color={color}>{glyph}</Text> <Text color={theme.ink}>{issue.message}</Text>
                </Text>
                <Text color={theme.inkFaint}>
                  {"  "}
                  {issue.file}
                  {issue.fix ? ` · ${issue.fixed ? "fixed" : "fix"}: ${issue.fix}` : ""}
                </Text>
              </Box>
            );
          })}
        </Box>
      )}
      <Box gap={2}>
        <Button label="Check again" keyName="r" onClick={check} clickable={active && !busy} compact />
        {fixable && <Button label="Fix" keyName="f" onClick={fix} clickable={active && !busy} compact />}
      </Box>
    </Box>
  );
}
