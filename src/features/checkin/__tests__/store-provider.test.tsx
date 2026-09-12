import React from 'react';
import { Text } from 'react-native';
import { act, render, screen } from '@testing-library/react-native';
import { CheckinStore, MemoryStorage } from '../store';
import { CheckinStoreProvider, useEventCache, useLoadedEvents } from '../store-provider';

function Probe({ slug }: { slug: string }) {
  const ev = useEventCache(slug);
  const events = useLoadedEvents();
  return (
    <Text>
      {events.length} eventos; {ev ? `${ev.signups.length} inscritos` : 'sem evento'}
    </Text>
  );
}

describe('CheckinStoreProvider', () => {
  it('re-renders when the store changes', async () => {
    const store = new CheckinStore({ storage: new MemoryStorage() });
    const { rerender } = await render(
      <CheckinStoreProvider store={store}>
        <Probe slug="ev" />
      </CheckinStoreProvider>,
    );
    expect(screen.getByText('0 eventos; sem evento')).toBeTruthy();
    // `act` from @testing-library/react-native 14 always wraps the callback
    // in an async boundary internally, so the update it schedules is only
    // guaranteed to be flushed once the returned promise is awaited.
    await act(() => {
      store.loadEvent('ev', 'Evento', [{ id: '1', name: 'Ana' }]);
    });
    expect(screen.getByText('1 eventos; 1 inscritos')).toBeTruthy();

    // A parent re-render with no store change must not loop: useLoadedEvents'
    // getSnapshot has to return the same cached array reference, or
    // useSyncExternalStore would keep scheduling renders (React would warn
    // "Maximum update depth exceeded" / "The result of getSnapshot should be
    // cached" and this assertion's console spy would catch it).
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    await act(() => {
      rerender(
        <CheckinStoreProvider store={store}>
          <Probe slug="ev" />
        </CheckinStoreProvider>,
      );
    });
    expect(screen.getByText('1 eventos; 1 inscritos')).toBeTruthy();
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
