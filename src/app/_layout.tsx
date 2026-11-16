import { ApolloProvider } from '@apollo/client';
import { SplashScreen } from 'expo-router';
import { useEffect, useState } from 'react';
import { AccessCache } from '@/features/auth/access-cache';
import { RootNavigator } from '@/components/root-navigator';
import { AuthProvider } from '@/features/auth/auth-provider';
import { SessionStore } from '@/features/auth/session';
import { CheckinStoreProvider, mmkvStorage } from '@/features/checkin/store-provider';
import { createApolloClient } from '@/lib/apollo-client';
import { secureStorage } from '@/lib/auth-token';

// The keychain is read before the first screen, so nobody sees the login flash by.
void SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [session] = useState(() => new SessionStore(secureStorage));
  const [client] = useState(() => createApolloClient(session.currentToken));
  const [accessCache] = useState(() => new AccessCache(mmkvStorage('session')));

  useEffect(() => {
    void session.restore();
  }, [session]);

  return (
    <ApolloProvider client={client}>
      <CheckinStoreProvider>
        <AuthProvider session={session} accessCache={accessCache}>
          <RootNavigator />
        </AuthProvider>
      </CheckinStoreProvider>
    </ApolloProvider>
  );
}
