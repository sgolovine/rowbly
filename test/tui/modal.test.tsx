import { Box, Text } from 'ink';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { Modal, type ModalProps } from '../../src/tui/components';
import { LayoutContext, useAsync } from '../../src/tui/hooks';
import { deferred } from '../helpers';
import { renderTui, waitForFrame } from './helpers';

function modalTree(children: ReactNode, size: ModalProps['size'], width = 100, height = 30) {
  return (
    <Box width={width} height={height}>
      <LayoutContext.Provider value={{ width, height }}>
        <Modal title="Details" size={size}>
          {children}
        </Modal>
      </LayoutContext.Provider>
    </Box>
  );
}

function modalBounds(frame: string) {
  const lines = frame.split('\n');
  const top = lines.findIndex((line) => line.includes('╭'));
  const bottom = lines.findIndex((line) => line.includes('╰'));
  return { top, height: bottom - top + 1 };
}

function DelayedContent({ load }: { load: () => Promise<string> }) {
  const { data } = useAsync(load, [load]);
  return <Text>{data ?? 'Loading details'}</Text>;
}

describe('Modal', () => {
  it.each(['panel', 'dialog'] as const)('fits a %s from its first visible frame', async (size) => {
    const app = renderTui(modalTree(<Text>Short content</Text>, size));
    try {
      await waitForFrame(app, (frame) => frame.includes('Short content') && modalBounds(frame).height === 7);
      expect(app.frames.length).toBeGreaterThan(0);
      for (const frame of app.frames) {
        expect(modalBounds(frame)).toEqual({ top: 12, height: 7 });
        expect(frame).toContain('Short content');
        expect(frame).toContain('esc close');
      }
    } finally {
      app.unmount();
    }
  });

  it.each(['panel', 'dialog'] as const)('clips a long %s without squashing its content or footer', async (size) => {
    const content = Array.from({ length: 40 }, (_, i) => `Line ${String(i + 1).padStart(2, '0')}`).join('\n');
    const app = renderTui(modalTree(<Text>{content}</Text>, size));
    try {
      await waitForFrame(app, 'Line 23');
      for (const frame of app.frames) {
        expect(modalBounds(frame)).toEqual({ top: 1, height: 28 });
        expect(frame).toContain('Line 01');
        expect(frame).toContain('Line 23');
        expect(frame).not.toContain('Line 24');
        expect(frame).toContain('esc close');
      }

      const start = app.frames.length;
      app.rerender(modalTree(<Text>{content}</Text>, size, 100, 18));
      await waitForFrame(app, (frame) => modalBounds(frame).height === 16);
      for (const frame of app.frames.slice(start)) {
        expect(modalBounds(frame)).toEqual({ top: 1, height: 16 });
        expect(frame).toContain('Line 11');
        expect(frame).not.toContain('Line 12');
        expect(frame).toContain('esc close');
      }
    } finally {
      app.unmount();
    }
  });

  it.each(['panel', 'dialog'] as const)('resizes a %s as delayed content arrives and then shrinks', async (size) => {
    const details = deferred<string>();
    const load = () => details.promise;
    const app = renderTui(modalTree(<DelayedContent load={load} />, size));
    try {
      await waitForFrame(app, 'Loading details');
      for (const frame of app.frames) expect(modalBounds(frame)).toEqual({ top: 12, height: 7 });

      const start = app.frames.length;
      details.resolve('Loaded details\nStage\nPriority\nAssignees\nDescription');
      await waitForFrame(app, 'Description');
      for (const frame of app.frames.slice(start)) {
        expect(modalBounds(frame)).toEqual({ top: 10, height: 11 });
        expect(frame).toContain('Loaded details');
        expect(frame).toContain('esc close');
      }

      const shrink = app.frames.length;
      app.rerender(modalTree(<Text>Short again</Text>, size));
      await waitForFrame(app, 'Short again');
      for (const frame of app.frames.slice(shrink)) expect(modalBounds(frame)).toEqual({ top: 12, height: 7 });
    } finally {
      details.resolve('Released');
      app.unmount();
    }
  });

  it('reflows wrapped text in the same frame as a width change', async () => {
    const content = <Text>{'word '.repeat(30).trim()}</Text>;
    const app = renderTui(modalTree(content, 'panel'));
    try {
      await waitForFrame(app, 'esc close');
      expect(modalBounds(app.lastFrame() ?? '')).toEqual({ top: 11, height: 8 });

      const start = app.frames.length;
      app.rerender(modalTree(content, 'panel', 50));
      await waitForFrame(app, (frame) => modalBounds(frame).height === 10);
      for (const frame of app.frames.slice(start)) expect(modalBounds(frame)).toEqual({ top: 10, height: 10 });
    } finally {
      app.unmount();
    }
  });

  it('fits an untitled confirmation without a footer from its first frame', async () => {
    const app = renderTui(
      <Box width={100} height={30}>
        <LayoutContext.Provider value={{ width: 100, height: 30 }}>
          <Modal size="dialog">
            <Text>Discard changes?</Text>
          </Modal>
        </LayoutContext.Provider>
      </Box>,
    );
    try {
      await waitForFrame(app, 'Discard changes?');
      for (const frame of app.frames) expect(modalBounds(frame)).toEqual({ top: 13, height: 5 });
    } finally {
      app.unmount();
    }
  });

  it('keeps content-sized inline output without a terminal height', async () => {
    const app = renderTui(
      <LayoutContext.Provider value={{ width: 100 }}>
        <Modal title="Details">
          <Text>Inline content</Text>
        </Modal>
      </LayoutContext.Provider>,
    );
    try {
      await waitForFrame(app, 'Inline content');
      for (const frame of app.frames) expect(modalBounds(frame)).toEqual({ top: 0, height: 7 });
    } finally {
      app.unmount();
    }
  });
});
