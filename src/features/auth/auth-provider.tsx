import { useApolloClient, useQuery } from '@apollo/client';
import { createContext, useCallback, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from 'react';
import { useCheckinStore } from '@/features/checkin/store-provider';
import type { AdminAccess } from '@/lib/admin-access';
import { ADMIN_ACCESS } from '@/lib/queries';
import { AccessCache, userKeyOf } from './access-cache';
import type { SessionState, SessionStore, SessionUser } from './session';

export type AccessStatus = 'none' | 'loading' | 'ready' | 'error';

export interface AuthValue {
  session: SessionState;
  /** What the BFF says this user may manage; the last confirmed answer while offline. */
  access: AdminAccess | null;
  accessStatus: AccessStatus;
  refreshAccess: () => Promise<void>;
  signIn: (token: string, user: SessionUser) => Promise<void>;
  /** Ends the session and wipes the attendees cached on the device (LGPD). */
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthValue | null>(null);

interface Props {
  session: SessionStore;
  accessCache: AccessCache;
  children: ReactNode;
}

/** Needs ApolloProvider and CheckinStoreProvider above it. */
export function AuthProvider({ session, accessCache, children }: Props) {
  const state = useSyncExternalStore(session.subscribe, session.getState);
  const client = useApolloClient();
  const checkin = useCheckinStore();
  const userKey = state.status === 'signedIn' ? userKeyOf(state.user) : null;

  const { data, loading, error, refetch } = useQuery<{ adminAccess: AdminAccess | null }>(ADMIN_ACCESS, {
    skip: !userKey,
    fetchPolicy: 'network-only',
    notifyOnNetworkStatusChange: true,
  });
  const fresh = userKey && data ? data.adminAccess : undefined;
  // The effect below keeps the stored copy in step with the server; it is read again whenever the
  // server's answer goes away (a refetch that failed offline), so the last confirmed one is used.
  const cached = useMemo(
    () => (userKey && fresh === undefined ? accessCache.read(userKey) : null),
    [accessCache, fresh, userKey],
  );

  useEffect(() => {
    if (!userKey || fresh === undefined) return;
    if (fresh === null) {
      // The BFF did not accept the token (revoked, user blocked): sign in again. The cached
      // check-ins are kept, so the same person picks up where they were.
      void session.signOut('expired');
      return;
    }
    accessCache.write(userKey, fresh);
  }, [accessCache, fresh, session, userKey]);

  const access = fresh ?? cached ?? null;
  const accessStatus: AccessStatus = !userKey
    ? 'none'
    : access
      ? 'ready'
      : error && !loading
        ? 'error'
        : 'loading';

  const refreshAccess = useCallback(async () => {
    if (!userKey) return;
    await refetch().catch(() => undefined);
  }, [refetch, userKey]);

  const signIn = useCallback(
    async (token: string, user: SessionUser) => {
      const key = userKeyOf(user);
      const owner = accessCache.owner();
      // Another person's events (and pending check-ins, which their token would have to send)
      // never reach this one.
      if (owner && owner !== key) checkin.clear();
      accessCache.setOwner(key);
      await session.signIn(token, user);
    },
    [accessCache, checkin, session],
  );

  const signOut = useCallback(async () => {
    checkin.clear();
    if (userKey) accessCache.clear(userKey);
    await client.clearStore().catch(() => undefined);
    await session.signOut();
  }, [accessCache, checkin, client, session, userKey]);

  const value = useMemo<AuthValue>(
    () => ({ session: state, access, accessStatus, refreshAccess, signIn, signOut }),
    [state, access, accessStatus, refreshAccess, signIn, signOut],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthValue {
  const value = useContext(Ctx);
  if (!value) throw new Error('useAuth fora de AuthProvider');
  return value;
}
