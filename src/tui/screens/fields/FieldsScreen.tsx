import { Text } from 'ink';
import { Loading } from '../../components';
import { theme } from '../../theme';
import { useConfigScope } from '../stages';
import type { ScreenProps } from '../types';
import { FieldsEditor } from './FieldsEditor';

/** Custom Field management: a list, a type-specific form, at the route's Configuration Cascade level. */
export function FieldsScreen({ params }: ScreenProps) {
  const scope = useConfigScope(params);
  if (!scope.data) {
    return scope.loading ? (
      <Loading label="Loading Custom Fields…" />
    ) : (
      <Text color={theme.danger}>No Custom Fields to show.</Text>
    );
  }
  return <FieldsEditor scope={scope.data} />;
}
