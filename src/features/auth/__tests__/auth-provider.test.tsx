import React, { useEffect } from 'react';
import { MockedProvider, type MockedResponse } from '@apollo/client/testing';
import { act, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';
import { CheckinStore, MemoryStorage } from '@/features/checkin/store';
import { CheckinStoreProvider } from '@/features/checkin/store-provider';
import { ADMIN_ACCESS } from '@/lib/queries';
import { accessResponse, eventManagerAccess, memorySecrets, validToken } from '@/test/auth-fixtures';
import { AccessCache } from '../access-cache';
import { AuthProvider, useAuth, type AuthValue } from '../auth-provider';
import { SessionStore } from '../session';

// Filled in an effect (not during render), so the tests can call signIn/signOut.
const probe: { current: AuthValue | null } = { current: null };
const auth = {
  signIn: (...args: Parameters<AuthValue['signIn']>) => probe.current!.signIn(...args),
  signOut: () => probe.current!.signOut(),
};
function Probe() {
  const value = useAuth();
  useEffect(() => {
    probe.current = value;
  }, [value]);
  return <Text>{`${value.session.status}|${value.accessStatus}|${value.access?.role ?? '-'}`}</Text>;
}

const flush = () => act(async () => new Promise((r) => setTimeout(r, 0)));

const setup = async (mocks: MockedResponse[], { cacheStorage = new MemoryStorage(), checkin = new CheckinStore({ storage: new MemoryStorage() }) } = {}) => {
  const session = new SessionStore(memorySecrets().storage);
  const accessCache = new AccessCache(cacheStorage);
  await session.restore();
  await render(
    <MockedProvider mocks={mocks}>
      <CheckinStoreProvider store={checkin}>
        <AuthProvider session={session} accessCache={accessCache}>
          <Probe />
        </AuthProvider>
      </CheckinStoreProvider>
    </MockedProvider>,
  );
  return { session, accessCache, checkin };
};

const ana = { id: '7', email: 'ana@x.io' };

describe('AuthProvider', () => {
  it('asks the BFF who the user is after the login and keeps the answer for offline use', async () => {
    const { accessCache } = await setup([{ request: { query: ADMIN_ACCESS }, result: accessResponse(eventManagerAccess) }]);
    expect(screen.getByText('signedOut|none|-')).toBeTruthy();
    await act(() => auth.signIn(validToken(), ana));
    await flush();
    expect(screen.getByText('signedIn|ready|event-manager')).toBeTruthy();
    expect(accessCache.read('7')?.canAccessAdmin).toBe(true);
  });

  it('uses the last confirmed access when the BFF is unreachable (the door has no signal)', async () => {
    const cacheStorage = new MemoryStorage();
    new AccessCache(cacheStorage).write('7', eventManagerAccess);
    await setup([{ request: { query: ADMIN_ACCESS }, error: new Error('Network request failed') }], { cacheStorage });
    await act(() => auth.signIn(validToken(), ana));
    await flush();
    expect(screen.getByText('signedIn|ready|event-manager')).toBeTruthy();
  });

  it('reports an error when offline with nothing cached', async () => {
    await setup([{ request: { query: ADMIN_ACCESS }, error: new Error('Network request failed') }]);
    await act(() => auth.signIn(validToken(), ana));
    await flush();
    expect(screen.getByText('signedIn|error|-')).toBeTruthy();
  });

  it('ends the session when the BFF does not accept the token, keeping the pending check-ins', async () => {
    const checkin = new CheckinStore({ storage: new MemoryStorage() });
    checkin.loadEvent('meetup-2', 'Meetup 2', [{ id: 's1', name: 'Bia' }]);
    checkin.checkIn('meetup-2', 's1');
    const { session } = await setup([{ request: { query: ADMIN_ACCESS }, result: accessResponse(null) }], { checkin });
    await act(() => auth.signIn(validToken(), ana));
    await flush();
    expect(session.getState()).toEqual({ status: 'signedOut', reason: 'expired' });
    expect(checkin.pendingCount()).toBe(1);
  });

  it("wipes another person's cached events when somebody else signs in on the device", async () => {
    const cacheStorage = new MemoryStorage();
    new AccessCache(cacheStorage).setOwner('99');
    const checkin = new CheckinStore({ storage: new MemoryStorage() });
    checkin.loadEvent('outro', 'Outro', [{ id: 's1', name: 'Caio' }]);
    await setup([{ request: { query: ADMIN_ACCESS }, result: accessResponse(eventManagerAccess) }], { cacheStorage, checkin });
    await act(() => auth.signIn(validToken(), ana));
    await flush();
    expect(checkin.listEvents()).toEqual([]);
  });

  it('keeps the cached events when the same person signs in again', async () => {
    const cacheStorage = new MemoryStorage();
    new AccessCache(cacheStorage).setOwner('7');
    const checkin = new CheckinStore({ storage: new MemoryStorage() });
    checkin.loadEvent('meetup-2', 'Meetup 2', []);
    await setup([{ request: { query: ADMIN_ACCESS }, result: accessResponse(eventManagerAccess) }], { cacheStorage, checkin });
    await act(() => auth.signIn(validToken(), ana));
    await flush();
    expect(checkin.listEvents()).toHaveLength(1);
  });

  it('signing out wipes the cached events and the cached access', async () => {
    const checkin = new CheckinStore({ storage: new MemoryStorage() });
    const { accessCache } = await setup([{ request: { query: ADMIN_ACCESS }, result: accessResponse(eventManagerAccess) }], { checkin });
    await act(() => auth.signIn(validToken(), ana));
    await flush();
    checkin.loadEvent('meetup-2', 'Meetup 2', []);
    await act(() => auth.signOut());
    expect(checkin.listEvents()).toEqual([]);
    expect(accessCache.read('7')).toBeNull();
    expect(screen.getByText('signedOut|none|-')).toBeTruthy();
  });
});
