import { ApolloProvider } from '@apollo/client';
import { Stack } from 'expo-router';
import { useState } from 'react';
import { createApolloClient } from '@/lib/apollo-client';

export default function RootLayout() {
  const [client] = useState(createApolloClient);
  return (
    <ApolloProvider client={client}>
      <Stack screenOptions={{ headerTitle: 'HubCommunity' }} />
    </ApolloProvider>
  );
}
