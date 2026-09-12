import React from 'react';
import { MockedProvider, type MockedResponse } from '@apollo/client/testing';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { CheckinStore, MemoryStorage } from '@/features/checkin/store';
import { CheckinStoreProvider } from '@/features/checkin/store-provider';
import { EVENTS, EVENT_SIGNUPS } from '@/lib/queries';
import { EventsHome } from '../events-home';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));

const event = { __typename: 'Event', id: '1', documentId: '1', slug: 'meetup', title: 'Meetup', start_date: '2026-10-01T12:00:00.000Z', location: null };
const mocks = [
  { request: { query: EVENTS, variables: { sort: [{ start_date: 'DESC' }] } }, result: { data: { events: { __typename: 'PaginatedEvents', data: [event] } } } },
  {
    request: { query: EVENT_SIGNUPS, variables: { eventSlug: 'meetup' } },
    result: { data: { eventSignups: [{ __typename: 'EventSignup', id: 's1', name: 'Ana', email: null, phone_number: null, checked_in: false, checked_in_at: null, product_name: null }] } },
  },
];

const renderHome = async (store: CheckinStore, providerMocks: MockedResponse[] = mocks) =>
  render(
    <MockedProvider mocks={providerMocks}>
      <CheckinStoreProvider store={store}>
        <EventsHome />
      </CheckinStoreProvider>
    </MockedProvider>,
  );

describe('EventsHome', () => {
  beforeEach(() => mockPush.mockClear());

  it('loads the event signups into the store and opens the check-in screen', async () => {
    const store = new CheckinStore({ storage: new MemoryStorage() });
    await renderHome(store);
    const button = await screen.findByText('Carregar evento');
    await act(async () => {
      fireEvent.press(button);
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(store.getEvent('meetup')?.signups).toHaveLength(1);
    expect(mockPush).toHaveBeenCalledWith('/checkin/meetup');
  });

  it('opens an already loaded event without refetching', async () => {
    const store = new CheckinStore({ storage: new MemoryStorage(), now: () => '2026-09-12T13:05:00.000Z' });
    store.loadEvent('meetup', 'Meetup', []);
    await renderHome(store);
    expect(await screen.findByText('Recarregar')).toBeTruthy();
    await fireEvent.press(screen.getByText('Abrir'));
    expect(mockPush).toHaveBeenCalledWith('/checkin/meetup');
  });

  it('lists loaded events and opens them even when the events query fails (offline cold start)', async () => {
    const store = new CheckinStore({ storage: new MemoryStorage(), now: () => '2026-09-12T13:05:00.000Z' });
    store.loadEvent('meetup', 'Meetup', []);
    const failing = [{ request: { query: EVENTS, variables: { sort: [{ start_date: 'DESC' }] } }, error: new Error('Network request failed') }];
    await renderHome(store, failing);
    expect(await screen.findByText(/Erro ao carregar eventos/)).toBeTruthy();
    expect(screen.getByText('Eventos carregados')).toBeTruthy();
    expect(screen.getByText('Meetup')).toBeTruthy();
    expect(screen.getByText(/carregado às/)).toBeTruthy();
    await fireEvent.press(screen.getByText('Abrir'));
    expect(mockPush).toHaveBeenCalledWith('/checkin/meetup');
  });
});
