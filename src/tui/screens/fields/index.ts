import type { ScreenRegistry } from '../types';
import { FieldsScreen } from './FieldsScreen';

export { describeField } from './describeField';

export const fieldsScreens: ScreenRegistry = {
  fields: FieldsScreen,
};
