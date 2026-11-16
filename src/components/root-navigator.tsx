import { SplashScreen, Stack } from 'expo-router';
import { useEffect } from 'react';
import { useAuth } from '@/features/auth/auth-provider';
import { canManageEvents } from '@/lib/admin-access';

/**
 * REA-58. Signed out: only the login. Signed in: the home. The management routes (event list,
 * check-in, walk-in, settings, kiosk) exist only for Admin, Community Manager and Event Manager;
 * when that guard turns false the router drops them from the history and goes back to the home.
 * The BFF checks the event on every call anyway (requireEventOrganizer).
 */
export function RootNavigator() {
  const { session, access } = useAuth();
  const ready = session.status !== 'loading';

  useEffect(() => {
    if (ready) SplashScreen.hide();
  }, [ready]);

  if (!ready) return null;
  const signedIn = session.status === 'signedIn';

  return (
    <Stack screenOptions={{ headerTitle: 'HubCommunity' }}>
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="login" options={{ headerShown: false }} />
      </Stack.Protected>
      <Stack.Protected guard={signedIn}>
        <Stack.Screen name="index" />
        <Stack.Protected guard={canManageEvents(access)}>
          <Stack.Screen name="gestao/index" options={{ headerTitle: 'Gestão de eventos' }} />
          <Stack.Screen name="checkin/[slug]/index" />
          <Stack.Screen name="checkin/[slug]/walkin" />
          <Stack.Screen name="checkin/[slug]/settings" />
          <Stack.Screen name="checkin/[slug]/kiosk" />
        </Stack.Protected>
      </Stack.Protected>
    </Stack>
  );
}
