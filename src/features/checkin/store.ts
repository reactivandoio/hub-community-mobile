import { mergeSignups } from './merge';
import {
  DEFAULT_SETTINGS,
  LOCAL_ID_PREFIX,
  type EventCache,
  type EventSettings,
  type LocalSignup,
  type OutboxItem,
  type ServerSignup,
  type WalkinInput,
} from './types';

export interface KeyValueStorage {
  getString(key: string): string | undefined;
  set(key: string, value: string): void;
  delete(key: string): void;
}

/** In-memory storage for tests. */
export class MemoryStorage implements KeyValueStorage {
  private map = new Map<string, string>();
  getString(key: string) {
    return this.map.get(key);
  }
  set(key: string, value: string) {
    this.map.set(key, value);
  }
  delete(key: string) {
    this.map.delete(key);
  }
}

export interface StoreDeps {
  storage: KeyValueStorage;
  now?: () => string;
  uuid?: () => string;
}

/** Summary returned by `listEvents`. Named `LoadedEventSummary` to avoid
 * clashing with the unrelated `EventSummary` in `src/lib/types.ts`. */
export interface LoadedEventSummary {
  slug: string;
  title: string;
  loadedAt: string;
  lastPullAt?: string;
}

const INDEX_KEY = 'checkin:index';
const eventKey = (slug: string) => `checkin:${slug}`;
const BACKOFF_SECONDS = [5, 15, 60];

const addSeconds = (iso: string, seconds: number) => new Date(Date.parse(iso) + seconds * 1000).toISOString();

const defaultUuid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

/**
 * Holds every loaded event in memory, persists each one as JSON under
 * `checkin:<slug>` and notifies subscribers after every mutation
 * (compatible with useSyncExternalStore).
 */
export class CheckinStore {
  private events = new Map<string, EventCache>();
  private listeners = new Set<() => void>();
  private storage: KeyValueStorage;
  private now: () => string;
  private uuid: () => string;

  constructor({ storage, now, uuid }: StoreDeps) {
    this.storage = storage;
    this.now = now ?? (() => new Date().toISOString());
    this.uuid = uuid ?? defaultUuid;
    this.rehydrate();
  }

  private rehydrate() {
    const slugs: string[] = JSON.parse(this.storage.getString(INDEX_KEY) ?? '[]');
    for (const slug of slugs) {
      const raw = this.storage.getString(eventKey(slug));
      if (raw) this.events.set(slug, JSON.parse(raw));
    }
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getEvent(slug: string): EventCache | undefined {
    return this.events.get(slug);
  }

  listEvents(): LoadedEventSummary[] {
    return [...this.events.values()].map(({ slug, title, loadedAt, lastPullAt }) => ({ slug, title, loadedAt, lastPullAt }));
  }

  loadEvent(slug: string, title: string, server: ServerSignup[]): EventCache {
    const prev = this.events.get(slug);
    const now = this.now();
    const next: EventCache = {
      slug,
      title,
      loadedAt: now,
      lastPullAt: now,
      signups: mergeSignups(prev?.signups ?? [], server),
      outbox: prev?.outbox ?? [],
      settings: prev?.settings ?? { ...DEFAULT_SETTINGS },
    };
    this.commit(next);
    return next;
  }

  applyPull(slug: string, server: ServerSignup[]) {
    this.update(slug, (ev) => ({ ...ev, signups: mergeSignups(ev.signups, server), lastPullAt: this.now() }));
  }

  checkIn(slug: string, signupId: string, opts: { enqueue?: boolean } = {}) {
    const ev = this.events.get(slug);
    const signup = ev?.signups.find((s) => s.id === signupId);
    if (!ev || !signup || signup.checked_in) return;
    const now = this.now();
    const outbox =
      opts.enqueue === false
        ? ev.outbox
        : [...ev.outbox, { id: this.uuid(), kind: 'checkin' as const, signupId, checkedInAt: now, createdAt: now, attempts: 0 }];
    this.commit({
      ...ev,
      signups: ev.signups.map((s) => (s.id === signupId ? { ...s, checked_in: true, checked_in_at: now } : s)),
      outbox,
    });
  }

  markPrinted(slug: string, signupId: string) {
    const now = this.now();
    this.update(slug, (ev) => ({
      ...ev,
      signups: ev.signups.map((s) => (s.id === signupId ? { ...s, printed_at: now } : s)),
    }));
  }

  addWalkin(slug: string, input: WalkinInput): LocalSignup {
    const ev = this.requireEvent(slug);
    const now = this.now();
    const localId = `${LOCAL_ID_PREFIX}${this.uuid()}`;
    const signup: LocalSignup = {
      id: localId,
      name: input.name,
      email: input.email,
      phone_number: input.phone_number,
      checked_in: false,
      source: 'walkin',
    };
    this.commit({
      ...ev,
      signups: [...ev.signups, signup],
      outbox: [...ev.outbox, { id: this.uuid(), kind: 'walkin', localId, input, batchId: ev.settings.batchId, createdAt: now, attempts: 0 }],
    });
    return signup;
  }

  resolveWalkin(slug: string, localId: string, server: ServerSignup) {
    this.update(slug, (ev) => ({
      ...ev,
      signups: ev.signups
        .filter((s) => s.id !== server.id || s.id === localId)
        .map((s) =>
          s.id === localId
            ? {
                ...s,
                id: server.id,
                name: server.name,
                email: server.email ?? s.email,
                phone_number: server.phone_number ?? s.phone_number,
                product_name: server.product_name ?? undefined,
                checked_in: s.checked_in || Boolean(server.checked_in),
              }
            : s,
        ),
      outbox: ev.outbox.map((item) => (item.kind === 'checkin' && item.signupId === localId ? { ...item, signupId: server.id } : item)),
    }));
  }

  outboxSucceeded(slug: string, itemId: string) {
    this.update(slug, (ev) => ({ ...ev, outbox: ev.outbox.filter((i) => i.id !== itemId) }));
  }

  outboxFailed(slug: string, itemId: string, error: string, { permanent }: { permanent: boolean }) {
    const now = this.now();
    this.update(slug, (ev) => ({
      ...ev,
      outbox: ev.outbox.map((item): OutboxItem => {
        if (item.id !== itemId) return item;
        if (permanent) return { ...item, lastError: error, failed: true, nextAttemptAt: undefined };
        const attempts = item.attempts + 1;
        const backoff = BACKOFF_SECONDS[Math.min(attempts, BACKOFF_SECONDS.length) - 1];
        return { ...item, attempts, lastError: error, nextAttemptAt: addSeconds(now, backoff) };
      }),
    }));
  }

  retryOutboxItem(slug: string, itemId: string) {
    this.update(slug, (ev) => ({
      ...ev,
      outbox: ev.outbox.map((item) => (item.id === itemId ? { ...item, failed: undefined, nextAttemptAt: undefined, attempts: 0 } : item)),
    }));
  }

  discardOutboxItem(slug: string, itemId: string) {
    this.update(slug, (ev) => ({ ...ev, outbox: ev.outbox.filter((i) => i.id !== itemId) }));
  }

  updateSettings(slug: string, patch: Partial<EventSettings>) {
    this.update(slug, (ev) => ({ ...ev, settings: { ...ev.settings, ...patch } }));
  }

  removeEvent(slug: string) {
    this.events.delete(slug);
    this.storage.delete(eventKey(slug));
    this.persistIndex();
    this.notify();
  }

  private requireEvent(slug: string): EventCache {
    const ev = this.events.get(slug);
    if (!ev) throw new Error(`Evento não carregado: ${slug}`);
    return ev;
  }

  private update(slug: string, fn: (ev: EventCache) => EventCache) {
    const ev = this.events.get(slug);
    if (ev) this.commit(fn(ev));
  }

  private commit(ev: EventCache) {
    const isNew = !this.events.has(ev.slug);
    this.events.set(ev.slug, ev);
    this.storage.set(eventKey(ev.slug), JSON.stringify(ev));
    if (isNew) this.persistIndex();
    this.notify();
  }

  private persistIndex() {
    this.storage.set(INDEX_KEY, JSON.stringify([...this.events.keys()]));
  }

  private notify() {
    this.listeners.forEach((l) => l());
  }
}
