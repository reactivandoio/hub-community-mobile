import React from 'react';
import { MockedProvider } from '@apollo/client/testing';
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

const renderHome = async (store: CheckinStore) =>
  render(
    <MockedProvider mocks={mocks}>
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
    fireEvent.press(await screen.findByText(/Abrir/));
    expect(mockPush).toHaveBeenCalledWith('/checkin/meetup');
  });
});
