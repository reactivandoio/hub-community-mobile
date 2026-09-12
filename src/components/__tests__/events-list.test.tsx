import React from 'react';
import { MockedProvider } from '@apollo/client/testing';
import { render, screen } from '@testing-library/react-native';
import { EventsList } from '../events-list';
import { EVENTS } from '@/lib/queries';

const event = (id: string, title: string) => ({
  __typename: 'Event',
  id,
  documentId: id,
  slug: title.toLowerCase(),
  title,
  start_date: '2026-10-01T12:00:00.000Z',
  location: { __typename: 'Location', title: 'Sebrae', city: 'Goiânia' },
});

const withEvents = (data: object[]) => [
  {
    request: { query: EVENTS, variables: { sort: [{ start_date: 'DESC' }] } },
    result: { data: { events: { __typename: 'PaginatedEvents', data } } },
  },
];

describe('EventsList', () => {
  it('renders the events returned by the BFF', async () => {
    await render(
      <MockedProvider mocks={withEvents([event('1', 'React Summit'), event('2', 'Node Day')])}>
        <EventsList />
      </MockedProvider>,
    );
    expect(await screen.findByText('React Summit')).toBeTruthy();
    expect(screen.getByText('Node Day')).toBeTruthy();
  });

  it('shows an empty state when there are no events', async () => {
    await render(
      <MockedProvider mocks={withEvents([])}>
        <EventsList />
      </MockedProvider>,
    );
    expect(await screen.findByText('Nenhum evento encontrado.')).toBeTruthy();
  });

  it('shows the error message when the request fails', async () => {
    const mocks = [
      {
        request: { query: EVENTS, variables: { sort: [{ start_date: 'DESC' }] } },
        error: new Error('Network request failed'),
      },
    ];
    await render(
      <MockedProvider mocks={mocks}>
        <EventsList />
      </MockedProvider>,
    );
    expect(await screen.findByText(/Network request failed/)).toBeTruthy();
  });
});
