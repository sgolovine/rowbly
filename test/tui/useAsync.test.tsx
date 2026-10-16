// `useAsync` turns every failure of its function into an error state and a toast, and drops the
// result of a run that is no longer current (RES-18C).
import { Text } from 'ink';
import { render } from 'ink-testing-library';
import { describe, expect, it } from 'vitest';
import { NotFoundError, ValidationError } from '../../src/core';
import { createToastStore, ToastContext, type ToastStore, useAsync } from '../../src/tui/hooks';
import { deferred } from '../helpers';
import { waitForFrame } from './helpers';

function Probe({ fn, dep = 0 }: { fn: () => Promise<string>; dep?: number }) {
  const state = useAsync(fn, [dep]);
  if (state.loading) return <Text>loading</Text>;
  if (state.error) return <Text>{`error: ${state.error instanceof Error ? state.error.message : 'other'}`}</Text>;
  return <Text>{`data: ${state.data}`}</Text>;
}

function mount(node: React.ReactElement, toasts: ToastStore = createToastStore()) {
  return { app: render(<ToastContext.Provider value={toasts}>{node}</ToastContext.Provider>), toasts };
}

describe('useAsync', () => {
  it('a function that throws synchronously becomes an error state and a toast', async () => {
    const { app, toasts } = mount(
      <Probe
        fn={() => {
          throw new ValidationError('bad input');
        }}
      />,
    );
    await waitForFrame(app, 'error: bad input');
    expect(toasts.list()).toMatchObject([{ kind: 'error', message: 'bad input' }]);
    app.unmount();
  });

  it('a rejected promise becomes an error state and a toast', async () => {
    const { app, toasts } = mount(<Probe fn={async () => Promise.reject(new NotFoundError('gone'))} />);
    await waitForFrame(app, 'error: gone');
    expect(toasts.list()).toHaveLength(1);
    app.unmount();
  });

  it('a result that settles after unmount is dropped', async () => {
    const late = deferred<string>();
    const { app, toasts } = mount(<Probe fn={() => late.promise} />);
    await waitForFrame(app, 'loading');
    const frames = app.frames.length;
    app.unmount();
    late.resolve('late');
    await late.promise;
    await new Promise((resolve) => setImmediate(resolve));
    expect(app.frames.slice(frames).join('')).not.toContain('data');
    expect(toasts.list()).toEqual([]);
  });

  it('only the run for the latest dependencies shows its result', async () => {
    const first = deferred<string>();
    const second = deferred<string>();
    const toasts = createToastStore();
    const { app } = mount(<Probe fn={() => first.promise} dep={1} />, toasts);
    await waitForFrame(app, 'loading');
    app.rerender(
      <ToastContext.Provider value={toasts}>
        <Probe fn={() => second.promise} dep={2} />
      </ToastContext.Provider>,
    );
    second.resolve('second');
    await waitForFrame(app, 'data: second');
    first.resolve('first');
    await first.promise;
    await new Promise((resolve) => setImmediate(resolve));
    expect(app.lastFrame()).toBe('data: second');
    app.unmount();
  });
});
