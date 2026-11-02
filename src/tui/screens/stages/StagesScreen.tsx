import { Text } from 'ink';
import { Loading } from '../../components';
import { theme } from '../../theme';
import type { ScreenProps } from '../types';
import { StagesEditor } from './StagesEditor';
import { useConfigScope } from './shared';

/** Stage management at the route's level; Backlog and Done stay fixed (ADR-0024). */
export function StagesScreen({ params }: ScreenProps) {
  const scope = useConfigScope(params);
  if (!scope.data)
    return scope.loading ? <Loading label="Loading Stages…" /> : <Text color={theme.danger}>No Stages to show.</Text>;
  return <StagesEditor scope={scope.data} />;
}
