import { Box, Text } from 'ink';
import { Component, type ReactNode } from 'react';
import { PluginError, type RowblyError } from '../../core';
import { attributePluginError } from '../../services';
import { theme } from '../theme';

interface PluginBoundaryProps {
  pluginId: string;
  /** Rendering again starts over only when one of these changes, e.g. the Plugin was loaded again. */
  resetKeys: readonly unknown[];
  children: ReactNode;
}

interface PluginBoundaryState {
  /** What the children threw, wrapped so that even a thrown `undefined` counts. */
  failure: { error: unknown } | undefined;
  resetKeys: readonly unknown[];
}

/**
 * Keeps a failure of Plugin `pluginId`'s screen, tab or section where it happened (RES-13): an error
 * thrown while its children render, or in their synchronous effects, shows a small fallback that
 * names the Plugin instead of taking down the screen. An expected Rowbly error keeps its message and
 * hint; anything else becomes a `PluginError` with a hint to turn the Plugin off (ADR-0020 §5).
 * Errors in event handlers and detached promises are outside it, as with any React boundary.
 */
export class PluginBoundary extends Component<PluginBoundaryProps, PluginBoundaryState> {
  override state: PluginBoundaryState = { failure: undefined, resetKeys: this.props.resetKeys };

  static getDerivedStateFromError(error: unknown): Partial<PluginBoundaryState> {
    return { failure: { error } };
  }

  static getDerivedStateFromProps(
    props: PluginBoundaryProps,
    state: PluginBoundaryState,
  ): Partial<PluginBoundaryState> | null {
    const changed =
      props.resetKeys.length !== state.resetKeys.length ||
      props.resetKeys.some((key, i) => !Object.is(key, state.resetKeys[i]));
    return changed ? { failure: undefined, resetKeys: props.resetKeys } : null;
  }

  override render() {
    const { failure } = this.state;
    if (!failure) return this.props.children;
    const { pluginId } = this.props;
    const error = attributePluginError({ plugin: pluginId, stage: 'screen' }, failure.error) as RowblyError;
    const message = error instanceof PluginError ? error.message : `Plugin "${pluginId}": ${error.message}`;
    return (
      <Box flexDirection="column">
        <Text color={theme.danger}>{message}</Text>
        {error.hint && <Text color={theme.inkFaint}>{error.hint}</Text>}
      </Box>
    );
  }
}
