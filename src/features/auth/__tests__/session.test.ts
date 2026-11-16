import { SessionStore, TOKEN_KEY, USER_KEY, type SecretStorage } from '../session';

const tokenWithExp = (offsetSeconds: number) =>
  `h.${btoa(JSON.stringify({ id: 7, exp: Math.floor(Date.now() / 1000) + offsetSeconds }))}.s`;

const memorySecrets = (initial: Record<string, string> = {}) => {
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

const user = { id: '7', email: 'ana@x.io', name: 'Ana' };

describe('SessionStore', () => {
  it('starts loading and restores a valid session from the keychain', async () => {
    const token = tokenWithExp(3600);
    const { storage } = memorySecrets({ [TOKEN_KEY]: token, [USER_KEY]: JSON.stringify(user) });
    const session = new SessionStore(storage);
    expect(session.getState()).toEqual({ status: 'loading' });
    await session.restore();
    expect(session.getState()).toEqual({ status: 'signedIn', token, user });
  });

  it('drops an expired session and says so', async () => {
    const { map, storage } = memorySecrets({ [TOKEN_KEY]: tokenWithExp(-60), [USER_KEY]: JSON.stringify(user) });
    const session = new SessionStore(storage);
    await session.restore();
    expect(session.getState()).toEqual({ status: 'signedOut', reason: 'expired' });
    expect(map.size).toBe(0);
  });

  it('treats a token without the user as signed out (a build that only stored the token)', async () => {
    const { map, storage } = memorySecrets({ [TOKEN_KEY]: tokenWithExp(3600) });
    const session = new SessionStore(storage);
    await session.restore();
    expect(session.getState().status).toBe('signedOut');
    expect(map.size).toBe(0);
  });

  it('starts signed out when the keychain throws', async () => {
    const storage: SecretStorage = {
      get: async () => {
        throw new Error('keychain');
      },
      set: async () => undefined,
      remove: async () => undefined,
    };
    const session = new SessionStore(storage);
    await session.restore();
    expect(session.getState().status).toBe('signedOut');
  });

  it('signs in, notifies and signs out wiping the keychain', async () => {
    const { map, storage } = memorySecrets();
    const session = new SessionStore(storage);
    const listener = jest.fn();
    session.subscribe(listener);
    const token = tokenWithExp(3600);
    await session.signIn(token, user);
    expect(map.get(TOKEN_KEY)).toBe(token);
    expect(JSON.parse(map.get(USER_KEY)!)).toEqual(user);
    expect(await session.currentToken()).toBe(token);
    await session.signOut();
    expect(map.size).toBe(0);
    expect(session.getState()).toEqual({ status: 'signedOut', reason: undefined });
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('never hands out an expired token and ends the session instead', async () => {
    const { storage } = memorySecrets();
    const session = new SessionStore(storage);
    await session.signIn(tokenWithExp(-1), user);
    expect(await session.currentToken()).toBeNull();
    expect(session.getState()).toEqual({ status: 'signedOut', reason: 'expired' });
  });
});
