// `useReloadOnReturn` reloads once each time its screen or tab becomes active again, never when it
// mounts or loses focus (ARCH-26, DX-25).
import { Text } from 'ink';
import { render } from 'ink-testing-library';
import { describe, expect, it } from 'vitest';
import { useReloadOnReturn } from '../../src/plugin-api/tui';
import { ActiveContext } from '../../src/tui/hooks';

function Probe({ reload, active }: { reload: () => void; active?: boolean }) {
  useReloadOnReturn(reload, active);
  return <Text>probe</Text>;
}

describe('useReloadOnReturn', () => {
  it('with an explicit flag: once per return, not on mount or blur', () => {
    let reloads = 0;
    const reload = () => {
      reloads++;
    };
    const app = render(<Probe reload={reload} active />);
    expect(reloads).toBe(0);
    app.rerender(<Probe reload={reload} active={false} />);
    expect(reloads).toBe(0);
    app.rerender(<Probe reload={reload} active />);
    app.rerender(<Probe reload={reload} active />);
    expect(reloads).toBe(1);
    app.rerender(<Probe reload={reload} active={false} />);
    app.rerender(<Probe reload={reload} active />);
    expect(reloads).toBe(2);
    app.unmount();
  });

  it('without one, follows whether the screen is active', () => {
    let reloads = 0;
    const reload = () => {
      reloads++;
    };
    const at = (active: boolean) => (
      <ActiveContext.Provider value={active}>
        <Probe reload={reload} />
      </ActiveContext.Provider>
    );
    const app = render(at(false));
    expect(reloads).toBe(0);
    app.rerender(at(true));
    expect(reloads).toBe(1);
    app.rerender(at(false));
    expect(reloads).toBe(1);
    app.unmount();
  });
});
