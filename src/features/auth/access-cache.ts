// The last `adminAccess` the BFF confirmed, per user (REA-58). The door of an event often has no
// signal: without this, an operator who opens the app offline would lose the management menu and
// with it the offline check-in. Only the server's answer changes it; a network error never does.
import type { KeyValueStorage } from '@/features/checkin/store';
import type { AdminAccess } from '@/lib/admin-access';

const keyOf = (userKey: string) => `access:${userKey}`;
const OWNER_KEY = 'owner';

export class AccessCache {
  constructor(private storage: KeyValueStorage) {}

  read(userKey: string): AdminAccess | null {
    const raw = this.storage.getString(keyOf(userKey));
    if (!raw) return null;
    try {
      return JSON.parse(raw) as AdminAccess;
    } catch {
      return null;
    }
  }

  write(userKey: string, access: AdminAccess) {
    this.storage.set(keyOf(userKey), JSON.stringify(access));
  }

  clear(userKey: string) {
    this.storage.delete(keyOf(userKey));
  }

  /** Who used the check-in on this device last (to wipe another person's cached events). */
  owner(): string | undefined {
    return this.storage.getString(OWNER_KEY) ?? undefined;
  }

  setOwner(userKey: string) {
    this.storage.set(OWNER_KEY, userKey);
  }
}

/** A stable key for the user: the id when the BFF returned one, else the e-mail. */
export const userKeyOf = (user: { id?: string | null; email: string }) => String(user.id || user.email.toLowerCase());
