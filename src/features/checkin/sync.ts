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

interface RunOptions {
  /** Fetch + merge the server list before pushing. Outbox growth pushes only. */
  pull: boolean;
  /** Skip the connectivity check (manual "Sincronizar agora"). */
  force: boolean;
}

const mergeRuns = (a: RunOptions | null, b: RunOptions): RunOptions => ({
  pull: (a?.pull ?? false) || b.pull,
  force: (a?.force ?? false) || b.force,
});

/**
 * Keeps one event in sync: pull (merge) every interval while online, push the
 * outbox whenever it grows or connectivity returns.
 *
 * Start, the interval, reconnects and `syncNow()` run pull then push; outbox
 * growth runs push only (a check-in must not wait for a full `eventSignups`
 * round trip). A failed pull still attempts the push.
 *
 * Only one run is in flight at a time: concurrent `syncNow()` calls share an
 * in-flight pull run. Anything the in-flight run cannot cover — outbox growth
 * observed *while* it runs (the snapshot `processOutbox` took can't see it),
 * or a pull requested during a push-only run — is merged into exactly one
 * follow-up run that starts right after the current one settles.
 *
 * `start()`/`stop()` bump a generation counter; a run from a superseded
 * generation (an old slug, or after `stop()`) detects the mismatch after its
 * next `await` and returns without touching the store or `status`, and
 * `processOutbox` stops between items for it.
 */
export class SyncEngine {
  private slug: string | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private unsubscribers: (() => void)[] = [];
  private status: SyncStatus;
  private listeners = new Set<() => void>();
  private running: Promise<void> | null = null;
  private runningOpts: RunOptions = { pull: true, force: false };
  private pending: RunOptions | null = null;
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
        void this.request({ pull: false, force: false });
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
    this.pending = null;
  }

  getStatus(): SyncStatus {
    return this.status;
  }

  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Pull + push now. `force` skips the connectivity check (manual
   * "Sincronizar agora"): NetInfo can misreport restricted venue networks, so
   * the request itself is the test — it fails fast into NetworkError if the
   * BFF really is unreachable. The automatic interval/reconnect runs keep the
   * check.
   */
  syncNow({ force = false }: { force?: boolean } = {}): Promise<void> {
    return this.request({ pull: true, force });
  }

  private request(opts: RunOptions): Promise<void> {
    if (this.running) {
      // An in-flight pull run already covers another pull request. A push
      // request (outbox growth the running snapshot can't see) or a pull
      // requested during a push-only run is queued as one merged follow-up.
      if (!opts.pull || !this.runningOpts.pull) this.pending = mergeRuns(this.pending, opts);
      return this.running;
    }
    this.runningOpts = opts;
    const runPromise: Promise<void> = this.run(opts).finally(() => {
      // A stop()/start() may have already replaced `running` with a newer
      // run; only the run that is still the current one may clear it or act
      // on `pending` (otherwise we'd swallow a follow-up that belongs to
      // that newer run).
      if (this.running !== runPromise) return;
      this.running = null;
      const pending = this.pending;
      this.pending = null;
      if (pending) void this.request(pending);
    });
    this.running = runPromise;
    return runPromise;
  }

  private async run({ pull, force }: RunOptions) {
    const { store, transport, connectivity, now } = this.deps;
    const slug = this.slug;
    const generation = this.generation;
    const isCurrent = () => this.generation === generation;
    if (!slug || (!force && !connectivity.isOnline())) return;
    this.setStatus({ syncing: true });
    try {
      let pullError: unknown = null;
      if (pull) {
        try {
          const server = await transport.fetchSignups(slug);
          if (!isCurrent()) return;
          store.applyPull(slug, server);
        } catch (e) {
          // Still push: a large pull can time out on a flaky link while the
          // small mutations get through.
          if (!isCurrent()) return;
          pullError = e;
        }
      }
      const report = await processOutbox(store, slug, transport, now, isCurrent);
      if (!isCurrent()) return;
      if (report.stoppedByNetwork) throw new Error('Sem conexão com o servidor');
      if (pullError) throw pullError;
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
