import { Box } from 'ink';
import { NotFoundError } from '../../core';
import { ActiveContext, ScreenDepthContext, useToast } from '../hooks';
import type { Route } from '../router';
import type { ScreenRegistry } from '../screens';
import { MissingScreen } from './MissingScreen';
import { ScreenBoundary } from './ScreenBoundary';

export function ScreenSlot({
  route,
  depth,
  top,
  active,
  screens,
}: {
  route: Route;
  depth: number;
  top: boolean;
  active: boolean;
  screens: ScreenRegistry;
}) {
  const toast = useToast();
  const Screen = screens[route.screen];
  return (
    <ScreenDepthContext.Provider value={depth}>
      <ActiveContext.Provider value={active}>
        <Box flexDirection="column" display={top ? 'flex' : 'none'}>
          <ScreenBoundary onError={(err) => toast.error(err)}>
            {Screen ? (
              <Screen params={route.params} />
            ) : (
              <MissingScreen
                name={route.screen}
                onMount={() => toast.error(new NotFoundError(`screen "${route.screen}" is not available`))}
              />
            )}
          </ScreenBoundary>
        </Box>
      </ActiveContext.Provider>
    </ScreenDepthContext.Provider>
  );
}
