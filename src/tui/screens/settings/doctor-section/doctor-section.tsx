import { Box, useInput } from "ink";
import { type Dispatch, type SetStateAction, useState } from "react";
import { type DoctorReport, doctor } from "../../../../services/doctor/doctor.js";
import type { ServiceContext } from "../../../../services/workspace/workspace.js";
import { Button, Loading } from "../../../components/index.js";
import { useAsync, useIsActive, useKeyHints } from "../../../hooks/index.js";
import type { KeyHint } from "../../../keymap.js";
import { DoctorReportView } from "../doctor-report/index.js";
import type { SettingsSectionProps } from "../settings-sections.js";

/** One run of the checks. A new `count` runs the checks again, also with the same `fix`. */
interface DoctorRun {
  readonly fix: boolean;
  readonly count: number;
}

/** Runs the checks. A fix that changed files tells Settings, so that the board reads them again. */
async function runDoctor(ctx: ServiceContext, run: DoctorRun, onChange: () => void): Promise<DoctorReport> {
  const result = await doctor({ fix: run.fix }, ctx);

  if (run.fix && result.issues.some((issue) => issue.fixed)) {
    onChange();
  }

  return result;
}

function nextRun(setRun: Dispatch<SetStateAction<DoctorRun>>, fix: boolean): void {
  setRun((current) => ({ fix, count: current.count + 1 }));
}

function doctorHints(idle: boolean, fixable: boolean): KeyHint[] {
  if (!idle) {
    return [];
  }

  return [{ key: "r", description: "check again" }, ...(fixable ? [{ key: "f", description: "fix" }] : [])];
}

function doctorKey(setRun: Dispatch<SetStateAction<DoctorRun>>, fixable: boolean, input: string): void {
  if (input === "r") {
    nextRun(setRun, false);

    return;
  }

  if (input === "f" && fixable) {
    nextRun(setRun, true);
  }
}

/**
 * Runs `rowbly doctor` when it opens, and shows each issue with its file and its fix. `r` runs the
 * checks again, and `f` applies the fixes that are available, as `rowbly doctor --fix` does.
 */
export function DoctorSection({ ctx, onChange }: SettingsSectionProps) {
  const active = useIsActive();
  const [run, setRun] = useState<DoctorRun>({ fix: false, count: 0 });
  const report = useAsync(() => runDoctor(ctx, run, onChange), [ctx, run]);

  const busy = report.loading;
  const fixable = report.data?.issues.some((issue) => issue.fix && !issue.fixed) ?? false;

  useKeyHints(doctorHints(active && !busy, fixable));
  useInput((input) => doctorKey(setRun, fixable, input), { isActive: active && !busy });

  if (!report.data) {
    return busy ? <Loading label="Checking the project…" /> : null;
  }

  const { issues, ok } = report.data;

  return (
    <Box flexDirection="column" gap={1}>
      <DoctorReportView issues={issues} ok={ok} busy={busy} />
      <Box gap={2}>
        <Button
          label="Check again"
          keyName="r"
          onClick={() => nextRun(setRun, false)}
          clickable={active && !busy}
          compact
        />
        {fixable && (
          <Button label="Fix" keyName="f" onClick={() => nextRun(setRun, true)} clickable={active && !busy} compact />
        )}
      </Box>
    </Box>
  );
}
