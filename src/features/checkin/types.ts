// Domain types for offline check-in. Everything here is plain data that is
// serialised to MMKV as JSON, so keep it free of classes and Dates.

export const LOCAL_ID_PREFIX = 'local:';
export const isLocalId = (id: string): boolean => id.startsWith(LOCAL_ID_PREFIX);

/** EventSignup as the BFF returns it. */
export interface ServerSignup {
  id: string;
  name: string;
  email?: string | null;
  phone_number?: string | null;
  checked_in?: boolean | null;
  checked_in_at?: string | null;
  product_name?: string | null;
}

export interface LocalSignup {
  /** Server id, or `local:<uuid>` until a walk-in is synced. */
  id: string;
  name: string;
  email?: string | null;
  phone_number?: string | null;
  product_name?: string | null;
  checked_in: boolean;
  checked_in_at?: string | null;
  source: 'server' | 'walkin';
  /** Last badge printed on this device (ISO). */
  printed_at?: string;
}

export interface WalkinInput {
  name: string;
  email: string;
  phone_number?: string;
}

interface OutboxBase {
  id: string;
  createdAt: string;
  attempts: number;
  /** Do not retry before this instant (ISO). */
  nextAttemptAt?: string;
  lastError?: string;
  /** Business failure (`success: false`); waits for the operator. */
  failed?: true;
}
export interface CheckinItem extends OutboxBase {
  kind: 'checkin';
  signupId: string;
  checkedInAt: string;
}
export interface WalkinItem extends OutboxBase {
  kind: 'walkin';
  localId: string;
  input: WalkinInput;
  batchId: string;
}
export type OutboxItem = CheckinItem | WalkinItem;

export interface EventSettings {
  logoText: string;
  link: string;
  batchId: string;
}
export const DEFAULT_SETTINGS: EventSettings = {
  logoText: 'COMUNIDADE',
  link: 'https://hubcommunity.io',
  batchId: '',
};

export interface EventCache {
  slug: string;
  title: string;
  loadedAt: string;
  lastPullAt?: string;
  signups: LocalSignup[];
  outbox: OutboxItem[];
  settings: EventSettings;
}
