import React from 'react';
import { screen } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';
import { Text } from 'react-native';
import type { AdminAccess } from '@/lib/admin-access';
import { accessOf, eventManagerAccess } from '@/test/auth-fixtures';
import { RootNavigator } from '../root-navigator';

let mockAuth: { session: { status: string }; access: AdminAccess | null } = {
  session: { status: 'signedOut' },
  access: null,
};
jest.mock('@/features/auth/auth-provider', () => ({ useAuth: () => mockAuth }));

// The real screens need Apollo, the store and native modules; the guard is what is under test.
const routes = {
  _layout: () => <RootNavigator />,
  index: () => <Text>home</Text>,
  login: () => <Text>login</Text>,
  'gestao/index': () => <Text>gestao</Text>,
  'checkin/[slug]/index': () => <Text>checkin</Text>,
  'checkin/[slug]/walkin': () => <Text>walkin</Text>,
  'checkin/[slug]/settings': () => <Text>settings</Text>,
  'checkin/[slug]/kiosk': () => <Text>kiosk</Text>,
};

const signedIn = { status: 'signedIn' };

describe('RootNavigator guards (REA-58)', () => {
  it('shows only the login while signed out', async () => {
    mockAuth = { session: { status: 'signedOut' }, access: null };
    await renderRouter(routes, { initialUrl: '/gestao' });
    expect(screen.getByText('login')).toBeTruthy();
  });

  it('keeps a participant out of the management routes', async () => {
    mockAuth = { session: signedIn, access: accessOf() };
    await renderRouter(routes, { initialUrl: '/checkin/meetup' });
    expect(screen.getByText('home')).toBeTruthy();
    expect(screen.queryByText('checkin')).toBeNull();
  });

  it('keeps everyone out while the access is still unknown', async () => {
    mockAuth = { session: signedIn, access: null };
    await renderRouter(routes, { initialUrl: '/gestao' });
    expect(screen.getByText('home')).toBeTruthy();
  });

  it('lets an event manager into the management routes', async () => {
    mockAuth = { session: signedIn, access: eventManagerAccess };
    await renderRouter(routes, { initialUrl: '/checkin/meetup-2' });
    expect(screen.getByText('checkin')).toBeTruthy();
  });
});
