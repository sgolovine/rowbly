import { useInput } from "ink";
import { useState } from "react";
import { getFactorySettings } from "../../../../services/factory-settings/factory-settings.js";
import type { HostCheck } from "../../../../services/host-check/host-check.js";
import { hostRows } from "../../../../services/host-project/host-rows.js";
import type { ServiceContext } from "../../../../services/workspace/workspace.js";
import { useAsync, useCursor, useIsActive, useKeyHints, useToast } from "../../../hooks/index.js";
import { type HostsEnv, handleHostsKey } from "./hosts-actions.js";
import { type HostBusy, type HostsTask, hostsHints } from "./hosts-view.js";

/** The inputs of the Hosts section. */
interface HostsSectionInput {
  readonly ctx: ServiceContext;
  readonly onChange: () => void;
}

/** The state of the Hosts section for one render. */
interface HostsSectionModel {
  readonly env: HostsEnv;
  readonly task: HostsTask;
  readonly cursor: number;
  readonly setCursor: (index: number) => void;
  /** The items of the last check of this session. */
  readonly check: HostCheck | null;
  /** True when the section has the keys and no form on top has them. */
  readonly idle: boolean;
}

/**
 * The state, the keys and the handlers of the Hosts section. It reads only local files. Only the add, the use and the check
 * actions open SSH. It does not load Pi.
 */
export function useHostsSection({ ctx, onChange }: HostsSectionInput): HostsSectionModel {
  const active = useIsActive();
  const toast = useToast();
  const [task, setTask] = useState<HostsTask>(null);
  const [busy, setBusy] = useState<HostBusy | null>(null);
  const [check, setCheck] = useState<HostCheck | null>(null);
  const settings = useAsync(() => getFactorySettings(ctx), [ctx]);
  const rows = useAsync(() => hostRows(ctx), [ctx]);

  const list = rows.data ?? [];
  const idle = active && task === null && settings.data !== undefined && rows.data !== undefined;
  const [cursor, setCursor] = useCursor(list.length, idle);
  const env: HostsEnv = {
    ctx,
    toast,
    settings,
    rows,
    row: list[cursor],
    busy,
    setBusy,
    setTask,
    setCheck,
    onChange,
  };

  useKeyHints(hostsHints(idle, list.length > 0));
  useInput((input, key) => handleHostsKey(env, input, key), { isActive: idle });

  return { env, task, cursor, setCursor, check, idle };
}
