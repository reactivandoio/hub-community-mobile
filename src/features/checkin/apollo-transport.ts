import { ApolloError, type ApolloClient } from '@apollo/client';
import { CHECKIN_SIGNUP, EVENT_SIGNUPS, MANUAL_SIGNUP } from '@/lib/queries';
import { NetworkError, type CheckinTransport, type MutationResult } from './transport';
import type { ServerSignup, WalkinInput } from './types';

const graphqlMessage = (result: unknown): string | undefined => {
  if (!result || typeof result !== 'object') return undefined;
  const errors = (result as { errors?: unknown }).errors;
  const first = Array.isArray(errors) ? errors[0] : undefined;
  return first && typeof first === 'object' && typeof (first as { message?: unknown }).message === 'string'
    ? (first as { message: string }).message
    : undefined;
};

/**
 * Sorts a failed request into "retry later" (NetworkError) vs "operator must
 * look at it" (plain Error):
 * - request never completed (offline, DNS, timeout), unparsable body (captive
 *   portal, proxy page), HTTP 5xx or 429 → NetworkError;
 * - any other HTTP status with a JSON body (4xx) → plain Error carrying the
 *   first GraphQL error message when the BFF sent one, so the operator sees
 *   e.g. `Unknown argument "checkedInAt"` instead of "Received status code 400".
 */
const rethrow = (e: unknown): never => {
  if (e instanceof ApolloError && e.networkError) {
    const ne = e.networkError as Error & { statusCode?: number; result?: unknown };
    const status = typeof ne.statusCode === 'number' ? ne.statusCode : undefined;
    if (status !== undefined && (status >= 500 || status === 429)) throw new NetworkError(ne.message);
    if (!('result' in ne)) throw new NetworkError(ne.message);
    throw new Error(graphqlMessage(ne.result) ?? ne.message);
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
