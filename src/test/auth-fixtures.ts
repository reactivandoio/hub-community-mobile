// Shared fakes for the auth tests (REA-58). Not a test file: jest only picks up __tests__/.
import type { SecretStorage } from '@/features/auth/session';
import type { AdminAccess } from '@/lib/admin-access';

export const memorySecrets = (initial: Record<string, string> = {}) => {
  const map = new Map(Object.entries(initial));
  const storage: SecretStorage = {
    get: async (k) => map.get(k) ?? null,
    set: async (k, v) => {
      map.set(k, v);
    },
    remove: async (k) => {
      map.delete(k);
    },
  };
  return { map, storage };
};

export const validToken = () => `h.${btoa(JSON.stringify({ id: 7, exp: Math.floor(Date.now() / 1000) + 3600 }))}.s`;

const NONE: AdminAccess = {
  role: 'authenticated',
  isAdmin: false,
  isCommunityManager: false,
  isEventManager: false,
  canAccessAdmin: false,
  communities: [],
  events: [],
};

export const accessOf = (patch: Partial<AdminAccess> = {}): AdminAccess => ({ ...NONE, ...patch });

export const eventManagerAccess = accessOf({
  role: 'event-manager',
  isEventManager: true,
  canAccessAdmin: true,
  events: [{ id: 'ev-2', title: 'Meetup 2', slug: 'meetup-2' }],
});

/** adminAccess as the BFF returns it (MockedProvider needs __typename). */
export const accessResponse = (access: AdminAccess | null) => ({
  data: {
    adminAccess: access && {
      __typename: 'AdminAccess',
      ...access,
      communities: access.communities.map((c) => ({ __typename: 'AdminCommunity', title: null, slug: null, ...c })),
      events: (access.events ?? []).map((e) => ({ __typename: 'AdminEvent', title: null, slug: null, ...e })),
    },
  },
});
