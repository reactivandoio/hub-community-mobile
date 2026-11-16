// The signed-in session (REA-58). Login is only by a code sent to the e-mail (REA-26): there is
// no password anywhere in the app. The token and a few profile fields live in the device
// keychain/keystore; this class keeps them in memory too, so the Apollo auth link and the screens
// read the same state synchronously.
import { isTokenExpired } from '@/lib/jwt';

export interface SessionUser {
  id?: string | null;
  email: string;
  name?: string | null;
  username?: string | null;
}

export type SessionState =
  | { status: 'loading' }
  | { status: 'signedOut'; reason?: 'expired' }
  | { status: 'signedIn'; token: string; user: SessionUser };

/** Async key-value store for secrets (expo-secure-store in the app, a Map in tests). */
export interface SecretStorage {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

// Same key as before, so nothing stored by earlier builds is orphaned.
export const TOKEN_KEY = 'auth_token';
export const USER_KEY = 'auth_user';

const parseUser = (raw: string | null): SessionUser | null => {
  if (!raw) return null;
  try {
    const user = JSON.parse(raw) as SessionUser;
    return typeof user?.email === 'string' ? user : null;
  } catch {
    return null;
  }
};

export class SessionStore {
  private state: SessionState = { status: 'loading' };
  private listeners = new Set<() => void>();

  constructor(private storage: SecretStorage) {}

  getState = (): SessionState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Reads what the last run left in the keychain. An expired or partial session is dropped. */
  async restore(): Promise<SessionState> {
    let token: string | null = null;
    let user: SessionUser | null = null;
    try {
      [token, user] = await Promise.all([
        this.storage.get(TOKEN_KEY),
        this.storage.get(USER_KEY).then(parseUser),
      ]);
    } catch {
      // Unreadable keychain (restored backup on another device): start signed out.
    }
    if (token && user && !isTokenExpired(token)) {
      this.set({ status: 'signedIn', token, user });
    } else {
      if (token || user) await this.wipe();
      this.set({ status: 'signedOut', reason: token ? 'expired' : undefined });
    }
    return this.state;
  }

  async signIn(token: string, user: SessionUser): Promise<void> {
    await Promise.all([this.storage.set(TOKEN_KEY, token), this.storage.set(USER_KEY, JSON.stringify(user))]);
    this.set({ status: 'signedIn', token, user });
  }

  async signOut(reason?: 'expired'): Promise<void> {
    await this.wipe();
    this.set({ status: 'signedOut', reason });
  }

  /**
   * The token the Apollo link should send, or null. An expired one is never sent: the session
   * ends here (the BFF would refuse it anyway) and the app goes back to the login screen.
   */
  currentToken = async (): Promise<string | null> => {
    const state = this.state;
    if (state.status !== 'signedIn') return null;
    if (isTokenExpired(state.token)) {
      await this.signOut('expired');
      return null;
    }
    return state.token;
  };

  private async wipe() {
    await Promise.all([this.storage.remove(TOKEN_KEY), this.storage.remove(USER_KEY)]).catch(() => undefined);
  }

  private set(next: SessionState) {
    this.state = next;
    this.listeners.forEach((l) => l());
  }
}
