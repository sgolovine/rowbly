import { Box, Text, useInput } from 'ink';
import { useContext, useState } from 'react';
import type { DoctorReport } from '../../../services';
import { Loading, SelectList } from '../../components';
import { ShellContext, useAsync, useIsActive, useKeyHints, useServices, useToast } from '../../hooks';

/** Runs `doctor` on open; `f` applies the safe fixes and `r` checks again. */
export function DoctorScreen() {
  const services = useServices();
  const shell = useContext(ShellContext);
  const toast = useToast();
  const active = useIsActive();
  const [fixing, setFixing] = useState(false);
  const [fixed, setFixed] = useState<DoctorReport | null>(null);
  const checked = useAsync(() => services.doctor.check(), [services]);
  const report = fixed ?? checked.data;
  const fixable = report?.findings.filter((f) => f.fixable).length ?? 0;

  useKeyHints([...(fixable > 0 ? [{ key: 'f', description: 'fix' }] : []), { key: 'r', description: 'check again' }]);
  useInput(
    (input) => {
      if (shell.captured().text || fixing) return;
      if (input === 'r') {
        setFixed(null);
        checked.reload();
      } else if (input === 'f' && fixable > 0) {
        setFixing(true);
        services.doctor
          .fix()
          .then(setFixed, (err: unknown) => toast.error(err))
          .finally(() => setFixing(false));
      }
    },
    { isActive: active },
  );

  if (fixing) return <Loading label="Fixing…" />;
  if (!report) return checked.loading ? <Loading label="Checking the Data Root…" /> : null;
  const { errors, warnings, info } = report.summary;
  return (
    <Box flexDirection="column">
      {report.fixed.length > 0 && (
        <Box flexDirection="column" marginBottom={1}>
          <Text color="green">Fixed ({report.fixed.length})</Text>
          {report.fixed.map((fix) => (
            <Text key={`${fix.code}:${fix.path}:${fix.message}`}>
              {'  '}
              {fix.message}
            </Text>
          ))}
        </Box>
      )}
      {report.findings.length === 0 ? (
        <Text color="green">No problems found</Text>
      ) : (
        <>
          <Text bold>
            {errors} error{errors === 1 ? '' : 's'}, {warnings} warning{warnings === 1 ? '' : 's'}, {info} info
            {fixable > 0 ? ` · ${fixable} fixable, press f` : ''}
          </Text>
          <SelectList
            limit={15}
            items={report.findings.map((finding, i) => ({
              value: i,
              label: `${finding.severity.padEnd(7)} ${finding.code}  ${finding.path}`,
              description: `${finding.message}${finding.fixable ? ' (fixable)' : ''}`,
            }))}
          />
        </>
      )}
    </Box>
  );
}
