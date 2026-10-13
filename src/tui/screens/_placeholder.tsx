import { Text } from 'ink';
import type { ScreenComponent } from './types';

/** A screen that says which work package will build it. */
export function placeholderScreen(title: string, workPackage: string): ScreenComponent {
  function Placeholder() {
    return (
      <Text>
        {title}: not implemented ({workPackage})
      </Text>
    );
  }
  Placeholder.displayName = `Placeholder(${title})`;
  return Placeholder;
}
