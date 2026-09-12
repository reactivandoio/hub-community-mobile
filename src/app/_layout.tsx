import { ApolloProvider } from '@apollo/client';
import { Stack } from 'expo-router';
import { useState } from 'react';
import { CheckinStoreProvider } from '@/features/checkin/store-provider';
import { createApolloClient } from '@/lib/apollo-client';

export default function RootLayout() {
  const [client] = useState(createApolloClient);
  return (
    <ApolloProvider client={client}>
      <CheckinStoreProvider>
        <Stack screenOptions={{ headerTitle: 'HubCommunity' }} />
      </CheckinStoreProvider>
    </ApolloProvider>
  );
}
