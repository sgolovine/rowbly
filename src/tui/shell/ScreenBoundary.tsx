import { Text } from 'ink';
import { Component, type ReactNode } from 'react';
import { RowblyError } from '../../core';
import { theme } from '../theme';

interface BoundaryProps {
  onError(err: RowblyError): void;
  children: ReactNode;
}

/** Turns a `RowblyError` thrown while rendering a screen into a toast; anything else is a bug and crashes. */
export class ScreenBoundary extends Component<BoundaryProps, { error: unknown }> {
  override state = { error: undefined as unknown };

  static getDerivedStateFromError(error: unknown) {
    return { error };
  }

  override componentDidCatch(error: unknown) {
    if (error instanceof RowblyError) this.props.onError(error);
  }

  override render() {
    const { error } = this.state;
    if (error === undefined) return this.props.children;
    if (!(error instanceof RowblyError)) throw error;
    return <Text color={theme.danger}>This screen could not be shown: {error.message}. Press esc to go back.</Text>;
  }
}
