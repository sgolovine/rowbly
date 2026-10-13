// Plain types shared by the storage and service layers. They live here, below storage, so that
// storage can return them without importing from services (README §3). `services/types.ts`
// re-exports them as part of the contracts §8 surface.

import type { BoardConfig } from './config';
import type { CustomFieldDef } from './customField';
import type { Stage } from './stage';

export type DataRootKind = 'local' | 'global';

/** A resolved Data Root: the absolute path of the `.rowbly` directory and how it was found. */
export interface DataRoot {
  path: string;
  kind: DataRootKind;
}

export type ConfigLevel = 'board' | 'global' | 'default';

export interface EffectiveBoardConfig {
  board: BoardConfig;
  stages: Stage[];
  stagesSource: ConfigLevel;
  customFields: CustomFieldDef[];
  customFieldsSource: ConfigLevel;
}
