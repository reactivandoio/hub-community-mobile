import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { CheckinStore, MemoryStorage } from '@/features/checkin/store';
import { CheckinStoreProvider } from '@/features/checkin/store-provider';
import { accessOf, eventManagerAccess } from '@/test/auth-fixtures';
import { HomeScreen } from '../home-screen';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('expo-web-browser', () => ({ openBrowserAsync: jest.fn() }));

const mockSignOut = jest.fn();
let mockAuth: Record<string, unknown> = {};
jest.mock('@/features/auth/auth-provider', () => ({ useAuth: () => mockAuth }));

const signedIn = { status: 'signedIn', token: 't', user: { id: '7', email: 'ana@x.io', name: 'Ana Lima' } };

const renderHome = (store = new CheckinStore({ storage: new MemoryStorage() })) =>
  render(
    <CheckinStoreProvider store={store}>
      <HomeScreen />
    </CheckinStoreProvider>,
  );

describe('HomeScreen', () => {
  beforeEach(() => {
    mockPush.mockClear();
    mockSignOut.mockClear();
  });

  it.each([
    ['admin', accessOf({ role: 'admin', isAdmin: true, canAccessAdmin: true })],
    ['community-manager', accessOf({ role: 'community-manager', isCommunityManager: true, canAccessAdmin: true })],
    ['event-manager', eventManagerAccess],
  ])('shows the management menu to %s and opens the event list', async (_, access) => {
    mockAuth = { session: signedIn, access, accessStatus: 'ready', signOut: mockSignOut };
    await renderHome();
    await fireEvent.press(screen.getByLabelText('Check-in dos meus eventos'));
    expect(mockPush).toHaveBeenCalledWith('/gestao');
  });

  it('hides the management menu from a participant', async () => {
    mockAuth = { session: signedIn, access: accessOf(), accessStatus: 'ready', signOut: mockSignOut };
    await renderHome();
    expect(screen.queryByLabelText('Check-in dos meus eventos')).toBeNull();
    expect(screen.getByText(/Em breve você verá aqui suas inscrições/)).toBeTruthy();
    expect(screen.getByText('Olá, Ana!')).toBeTruthy();
  });

  it('shows no menu while the access is unknown, and offers a retry on error', async () => {
    const refreshAccess = jest.fn();
    mockAuth = { session: signedIn, access: null, accessStatus: 'error', refreshAccess, signOut: mockSignOut };
    await renderHome();
    expect(screen.queryByLabelText('Check-in dos meus eventos')).toBeNull();
    await fireEvent.press(screen.getByLabelText('Tentar de novo'));
    expect(refreshAccess).toHaveBeenCalled();
  });

  it('warns about unsent check-ins before signing out', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const store = new CheckinStore({ storage: new MemoryStorage() });
    store.loadEvent('meetup-2', 'Meetup 2', [{ id: 's1', name: 'Bia' }]);
    store.checkIn('meetup-2', 's1');
    mockAuth = { session: signedIn, access: eventManagerAccess, accessStatus: 'ready', signOut: mockSignOut };
    await renderHome(store);
    await fireEvent.press(screen.getByLabelText('Sair'));
    const [title, message, buttons] = alert.mock.calls[0];
    expect(title).toBe('Sair da conta?');
    expect(message).toMatch(/1 registro ainda não foi enviado/);
    (buttons as { text: string; onPress?: () => void }[]).find((b) => b.text === 'Sair')?.onPress?.();
    expect(mockSignOut).toHaveBeenCalled();
    alert.mockRestore();
  });
});
