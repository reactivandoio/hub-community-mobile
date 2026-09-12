import { ApolloError, type ApolloClient } from '@apollo/client';
import { CHECKIN_SIGNUP, EVENT_SIGNUPS, MANUAL_SIGNUP } from '@/lib/queries';
import { NetworkError, type CheckinTransport, type MutationResult } from './transport';
import type { ServerSignup, WalkinInput } from './types';

const rethrow = (e: unknown): never => {
  if (e instanceof ApolloError && e.networkError && !('result' in e.networkError)) {
    throw new NetworkError(e.networkError.message);
  }
  if (e instanceof TypeError && /network/i.test(e.message)) throw new NetworkError(e.message);
  throw e instanceof Error ? e : new Error(String(e));
};

export function createApolloTransport(client: ApolloClient<unknown>): CheckinTransport {
  return {
    async fetchSignups(eventSlug) {
      try {
        const { data } = await client.query<{ eventSignups: (ServerSignup | null)[] | null }>({
          query: EVENT_SIGNUPS,
          variables: { eventSlug },
          // 'no-cache': with a named fragment and InMemoryCache's addTypename
          // disabled (as the test client does), a 'network-only' read still
          // goes through the cache's fragment matcher, which needs __typename
          // to resolve `...EventSignupFields` and otherwise returns `{}` per
          // item. 'no-cache' returns the network result untouched, which is
          // also the right policy for a value we only ever pull once and
          // never read back from the cache.
          fetchPolicy: 'no-cache',
        });
        return (data.eventSignups ?? []).filter((s): s is ServerSignup => s != null);
      } catch (e) {
        return rethrow(e);
      }
    },
    async checkin(eventSlug, signupId, checkedInAt) {
      try {
        const { data } = await client.mutate<{ checkinSignup: MutationResult }>({
          mutation: CHECKIN_SIGNUP,
          variables: { eventSlug, signupId, checkedInAt },
        });
        return data?.checkinSignup ?? { success: false, message: 'Resposta vazia' };
      } catch (e) {
        return rethrow(e);
      }
    },
    async walkin(eventSlug, batchId, input: WalkinInput) {
      try {
        const { data } = await client.mutate<{ manualSignup: MutationResult }>({
          mutation: MANUAL_SIGNUP,
          variables: { eventSlug, batchId, input },
        });
        return data?.manualSignup ?? { success: false, message: 'Resposta vazia' };
      } catch (e) {
        return rethrow(e);
      }
    },
  };
}
