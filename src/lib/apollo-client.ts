import { ApolloClient, ApolloLink, HttpLink, InMemoryCache } from '@apollo/client';
import { setContext } from '@apollo/client/link/context';
import { isTokenExpired } from './jwt';

interface AuthLinkOptions {
  getToken: () => Promise<string | null>;
  // Called when a stored token turns out to be expired; it is never sent to the BFF.
  onExpired?: () => void | Promise<void>;
}

// Mirrors the web frontend's authLink: attach `Authorization: Bearer` only for a
// stored, non-expired token. Exported for testing with an injectable token source.
export const createAuthLink = ({ getToken, onExpired }: AuthLinkOptions): ApolloLink =>
  setContext(async (_operation, { headers }) => {
    const token = await getToken();
    if (!token) return { headers };
    if (isTokenExpired(token)) {
      await onExpired?.();
      return { headers };
    }
    return { headers: { ...headers, authorization: `Bearer ${token}` } };
  });

export const GRAPHQL_URL = process.env.EXPO_PUBLIC_GRAPHQL_URL ?? 'https://bff.hubcommunity.io/graphql';

// `getToken` is the session's (SessionStore.currentToken): it already ends an expired session.
export const createApolloClient = (getToken: () => Promise<string | null>) =>
  new ApolloClient({
    link: ApolloLink.from([
      createAuthLink({ getToken }),
      new HttpLink({ uri: GRAPHQL_URL }),
    ]),
    cache: new InMemoryCache(),
  });
