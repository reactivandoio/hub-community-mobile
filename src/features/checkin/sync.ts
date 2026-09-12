import { processOutbox } from './outbox';
import type { CheckinStore } from './store';
import type { CheckinTransport } from './transport';

export interface Connectivity {
  isOnline(): boolean;
  subscribe(cb: (online: boolean) => void): () => void;
}

/** Connectivity you can flip by hand (tests, dev). */
export class FakeConnectivity implements Connectivity {
  private listeners = new Set<(online: boolean) => void>();
  constructor(private online = true) {}
  isOnline() {
    return this.online;
  }
  subscribe(cb: (online: boolean) => void) {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }
  set(online: boolean) {
    this.online = online;
    this.listeners.forEach((l) => l(online));
  }
}

export interface SyncStatus {
  online: boolean;
  syncing: boolean;
  lastError?: string;
  lastSyncAt?: string;
}

interface Deps {
  store: CheckinStore;
  transport: CheckinTransport;
  connectivity: Connectivity;
  pullIntervalMs?: number;
  now?: () => string;
}

/**
 * Keeps one event in sync: pull (merge) every interval while online, push the
 * outbox whenever it grows or connectivity returns. Only one sync runs at a
 * time; concurrent calls share that in-flight run instead of starting a new
 * one (a call made after it settles always starts a fresh run, so nothing is
 * silently dropped for long — the next interval tick or outbox growth will
 * trigger it).
 */
export class SyncEngine {
  private slug: string | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private unsubscribers: (() => void)[] = [];
  private status: SyncStatus;
  private listeners = new Set<() => void>();
  private running: Promise<void> | null = null;
  private lastOutboxLength = 0;
  private deps: Required<Deps>;

  constructor(deps: Deps) {
    this.deps = {
      pullIntervalMs: 30_000,
      now: () => new Date().toISOString(),
      ...deps,
    };
    this.status = { online: deps.connectivity.isOnline(), syncing: false };
  }

  start(slug: string) {
    this.stop();
    this.slug = slug;
    this.lastOutboxLength = this.deps.store.getEvent(slug)?.outbox.length ?? 0;
    this.timer = setInterval(() => void this.syncNow(), this.deps.pullIntervalMs);
    this.unsubscribers.push(
      this.deps.connectivity.subscribe((online) => {
        this.setStatus({ online });
        if (online) void this.syncNow();
      }),
      this.deps.store.subscribe(() => {
        const len = this.deps.store.getEvent(slug)?.outbox.length ?? 0;
        const grew = len > this.lastOutboxLength;
        this.lastOutboxLength = len;
        if (grew) void this.syncNow();
      }),
    );
    void this.syncNow();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.unsubscribers.forEach((u) => u());
    this.unsubscribers = [];
    this.slug = null;
  }

  getStatus(): SyncStatus {
    return this.status;
  }

  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  syncNow(): Promise<void> {
    if (!this.running) {
      this.running = this.run().finally(() => {
        this.running = null;
      });
    }
    return this.running;
  }

  private async run() {
    const { store, transport, connectivity, now } = this.deps;
    const slug = this.slug;
    if (!slug || !connectivity.isOnline()) return;
    this.setStatus({ syncing: true });
    try {
      store.applyPull(slug, await transport.fetchSignups(slug));
      const report = await processOutbox(store, slug, transport, now);
      if (report.stoppedByNetwork) throw new Error('Sem conexão com o servidor');
      this.setStatus({ syncing: false, lastError: undefined, lastSyncAt: now() });
    } catch (e) {
      this.setStatus({ syncing: false, lastError: e instanceof Error ? e.message : String(e) });
    }
  }

  private setStatus(patch: Partial<SyncStatus>) {
    this.status = { ...this.status, ...patch };
    this.listeners.forEach((l) => l());
  }
}
