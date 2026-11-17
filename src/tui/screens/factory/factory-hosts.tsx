import { Text } from "ink";
import type { FactoryStatus } from "../../../services/factory/factory.js";
import { LOCAL_HOST } from "../../../services/thread/thread.js";
import { contactText, hostLost, lastContactMs } from "../../../services/thread-connection/thread-connection.js";
import { theme } from "../../theme.js";

/** One host of the factory status. */
type HostEntry = NonNullable<FactoryStatus["hosts"]>[number];

/** The hosts of a live factory with a worker host, `local` first. Without a worker host, no hosts. */
export function workerHosts(status: FactoryStatus | undefined, live: boolean): readonly HostEntry[] {
  const hosts = live ? (status?.hosts ?? []) : [];

  return hosts.some((host) => host.id !== LOCAL_HOST) ? hosts : [];
}

/** The colour of a host state: `danger` for a lost host, `stage-board` for a slow host. */
function stateColor(host: HostEntry, hosts: readonly HostEntry[]): string {
  if (hostLost(host.id, hosts)) {
    return theme.danger;
  }

  return host.state === "degraded" ? theme.stageBoard : theme.ink;
}

/** One row of the `Hosts` list: the id, the state, the used and the total slots, and the last contact of a lost host. */
export function hostRow(host: HostEntry, hosts: readonly HostEntry[], now: number) {
  const lost = hostLost(host.id, hosts);

  return (
    <Text wrap="truncate-end">
      <Text color={theme.ink}>{host.id}</Text>
      <Text color={stateColor(host, hosts)}> {host.state}</Text>
      <Text color={theme.inkFaint}> · </Text>
      <Text color={theme.inkMuted}>
        {host.used}/{host.max}
      </Text>
      {lost && <Text color={theme.inkFaint}> · </Text>}
      {lost && <Text color={theme.inkMuted}>{contactText(lastContactMs(host.lastSeenAt, now))}</Text>}
    </Text>
  );
}
