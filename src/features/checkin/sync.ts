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
 * outbox whenever it grows or connectivity returns.
 *
 * Only one sync runs at a time: concurrent `syncNow()` calls share the
 * in-flight run rather than starting a new one. But outbox growth observed
 * *while* a run is in flight (the outbox snapshot `processOutbox` took at the
 * start of that run can't see it) schedules exactly one follow-up run right
 * after the current one settles, so a check-in or walk-in enqueued mid-run is
 * still pushed promptly instead of waiting for the next pull interval.
 *
 * `start()`/`stop()` bump a generation counter; a run from a superseded
 * generation (an old slug, or after `stop()`) detects the mismatch after its
 * next `await` and returns without touching the store or `status`.
 */
export class SyncEngine {
  private slug: string | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private unsubscribers: (() => void)[] = [];
  private status: SyncStatus;
  private listeners = new Set<() => void>();
  private running: Promise<void> | null = null;
  private pendingRerun = false;
  private lastOutboxLength = 0;
  private generation = 0;
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
        if (!grew) return;
        // A run in flight already took its outbox snapshot; make sure this
        // new item gets a run of its own once it settles instead of waiting
        // for the next pull interval. When nothing is running, sync right away.
        if (this.running) {
          this.pendingRerun = true;
        } else {
          void this.syncNow();
        }
      }),
    );
    void this.syncNow();
  }

  stop() {
    // Invalidate any in-flight run for the previous slug/session: it will
    // notice the generation mismatch after its next await and bail out
    // without writing to the store or status.
    this.generation += 1;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.unsubscribers.forEach((u) => u());
    this.unsubscribers = [];
    this.slug = null;
    this.running = null;
    this.pendingRerun = false;
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
      const runPromise: Promise<void> = this.run().finally(() => {
        // A stop()/start() may have already replaced `running` with a newer
        // run; only the run that is still the current one may clear it or
        // act on `pendingRerun` (otherwise we'd swallow a pending follow-up
        // that belongs to that newer run).
        if (this.running !== runPromise) return;
        this.running = null;
        if (this.pendingRerun) {
          this.pendingRerun = false;
          void this.syncNow();
        }
      });
      this.running = runPromise;
    }
    return this.running;
  }

  private async run() {
    const { store, transport, connectivity, now } = this.deps;
    const slug = this.slug;
    const generation = this.generation;
    const isCurrent = () => this.generation === generation;
    if (!slug || !connectivity.isOnline()) return;
    this.setStatus({ syncing: true });
    try {
      const server = await transport.fetchSignups(slug);
      if (!isCurrent()) return;
      store.applyPull(slug, server);
      const report = await processOutbox(store, slug, transport, now);
      if (!isCurrent()) return;
      if (report.stoppedByNetwork) throw new Error('Sem conexão com o servidor');
      this.setStatus({ syncing: false, lastError: undefined, lastSyncAt: now() });
    } catch (e) {
      if (!isCurrent()) return;
      this.setStatus({ syncing: false, lastError: e instanceof Error ? e.message : String(e) });
    }
  }

  private setStatus(patch: Partial<SyncStatus>) {
    this.status = { ...this.status, ...patch };
    this.listeners.forEach((l) => l());
  }
}
