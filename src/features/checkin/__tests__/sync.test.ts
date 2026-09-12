import { CheckinStore, MemoryStorage } from '../store';
import { FakeConnectivity, SyncEngine } from '../sync';
import { NetworkError, type CheckinTransport, type MutationResult } from '../transport';
import type { ServerSignup } from '../types';

const flush = () => new Promise<void>((r) => setImmediate(() => r()));

const make = (online = true) => {
  const store = new CheckinStore({ storage: new MemoryStorage(), uuid: () => 'u' });
  store.loadEvent('ev', 'Evento', [{ id: 's1', name: 'Ana' }]);
  const transport: jest.Mocked<CheckinTransport> = {
    fetchSignups: jest.fn().mockResolvedValue([{ id: 's1', name: 'Ana' }, { id: 's2', name: 'Bia' }]),
    checkin: jest.fn().mockResolvedValue({ success: true }),
    walkin: jest.fn().mockResolvedValue({ success: true, signup: { id: 's9', name: 'C' } }),
  };
  const connectivity = new FakeConnectivity(online);
  const engine = new SyncEngine({ store, transport, connectivity, pullIntervalMs: 30_000 });
  return { store, transport, connectivity, engine };
};

beforeEach(() => jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] }));
afterEach(() => jest.useRealTimers());

describe('SyncEngine', () => {
  it('pulls immediately on start and every interval while online', async () => {
    const { engine, transport, store } = make();
    engine.start('ev');
    await flush();
    expect(transport.fetchSignups).toHaveBeenCalledTimes(1);
    expect(store.getEvent('ev')!.signups).toHaveLength(2);
    jest.advanceTimersByTime(30_000);
    await flush();
    expect(transport.fetchSignups).toHaveBeenCalledTimes(2);
    engine.stop();
    jest.advanceTimersByTime(60_000);
    expect(transport.fetchSignups).toHaveBeenCalledTimes(2);
  });

  it('does nothing while offline and syncs when connectivity returns', async () => {
    const { engine, transport, connectivity, store } = make(false);
    store.checkIn('ev', 's1');
    engine.start('ev');
    await flush();
    expect(transport.fetchSignups).not.toHaveBeenCalled();
    expect(engine.getStatus().online).toBe(false);
    connectivity.set(true);
    await flush();
    expect(transport.fetchSignups).toHaveBeenCalledTimes(1);
    expect(transport.checkin).toHaveBeenCalledWith('ev', 's1', expect.any(String));
    expect(store.getEvent('ev')!.outbox).toEqual([]);
  });

  it('syncNow({ force: true }) attempts the run even while connectivity reports offline', async () => {
    const { engine, transport, store } = make(false);
    store.checkIn('ev', 's1');
    engine.start('ev');
    await flush();
    await engine.syncNow();
    expect(transport.fetchSignups).not.toHaveBeenCalled();
    await engine.syncNow({ force: true });
    expect(transport.fetchSignups).toHaveBeenCalledTimes(1);
    expect(transport.checkin).toHaveBeenCalledTimes(1);
    expect(engine.getStatus().lastSyncAt).toEqual(expect.any(String));
  });

  it('pushes new outbox items as they are enqueued, without pulling again', async () => {
    const { engine, transport, store } = make();
    engine.start('ev');
    await flush();
    expect(transport.fetchSignups).toHaveBeenCalledTimes(1);
    store.checkIn('ev', 's1');
    await flush();
    expect(transport.checkin).toHaveBeenCalledTimes(1);
    expect(transport.fetchSignups).toHaveBeenCalledTimes(1);
  });

  it('still pushes the outbox when the pull fails with a non-network error', async () => {
    const { engine, transport, store } = make();
    transport.fetchSignups.mockRejectedValueOnce(new Error('GraphQL boom'));
    store.checkIn('ev', 's1');
    engine.start('ev');
    await flush();
    expect(transport.checkin).toHaveBeenCalledWith('ev', 's1', expect.any(String));
    expect(store.getEvent('ev')!.outbox).toEqual([]);
    expect(engine.getStatus()).toMatchObject({ syncing: false, lastError: 'GraphQL boom' });
  });

  it('a manual sync requested during a push-only run is followed by a pull', async () => {
    const { engine, transport, store } = make();
    engine.start('ev');
    await flush();
    let resolveCheckin: (value: MutationResult) => void = () => {};
    transport.checkin.mockImplementationOnce(() => new Promise((resolve) => (resolveCheckin = resolve)));
    store.checkIn('ev', 's1'); // push-only run, blocked on checkin
    await flush();
    expect(transport.fetchSignups).toHaveBeenCalledTimes(1);
    const manual = engine.syncNow();
    resolveCheckin({ success: true });
    await manual;
    await flush();
    expect(transport.fetchSignups).toHaveBeenCalledTimes(2);
  });

  it('records network failures in the status and keeps going', async () => {
    const { engine, transport } = make();
    transport.fetchSignups.mockRejectedValueOnce(new NetworkError('offline'));
    engine.start('ev');
    await flush();
    expect(engine.getStatus()).toMatchObject({ syncing: false, lastError: 'offline' });
    jest.advanceTimersByTime(30_000);
    await flush();
    expect(engine.getStatus().lastError).toBeUndefined();
    expect(engine.getStatus().lastSyncAt).toEqual(expect.any(String));
  });

  it('syncNow runs pull and push once even if called twice concurrently', async () => {
    const { engine, transport } = make();
    engine.start('ev');
    await flush();
    transport.fetchSignups.mockClear();
    await Promise.all([engine.syncNow(), engine.syncNow()]);
    expect(transport.fetchSignups).toHaveBeenCalledTimes(1);
  });

  it('pushes a check-in enqueued while the pull is still in flight, without advancing timers', async () => {
    const { engine, transport, store } = make();
    let resolveFetch: (value: ServerSignup[]) => void = () => {};
    transport.fetchSignups.mockImplementationOnce(() => new Promise((resolve) => (resolveFetch = resolve)));
    engine.start('ev');
    await flush();
    expect(transport.checkin).not.toHaveBeenCalled();
    store.checkIn('ev', 's1');
    resolveFetch([{ id: 's1', name: 'Ana' }, { id: 's2', name: 'Bia' }]);
    await flush();
    expect(transport.checkin).toHaveBeenCalledWith('ev', 's1', expect.any(String));
  });

  it('pushes an item enqueued mid-run after the outbox snapshot for that run was already taken', async () => {
    // Stronger regression than the case above: s2 is enqueued *after* the
    // outbox-processing run has already captured its item list (it is
    // sitting mid-loop on the deferred checkin below), so only the
    // growth-triggered follow-up run (not the current one) can push it.
    // Uses its own store with unique outbox ids (`make()`'s constant `'u'`
    // id would make the two enqueued items indistinguishable to the store).
    let nextId = 0;
    const store = new CheckinStore({ storage: new MemoryStorage(), uuid: () => `id${++nextId}` });
    store.loadEvent('ev', 'Evento', [{ id: 's1', name: 'Ana' }]);
    let resolveFirstCheckin: (value: MutationResult) => void = () => {};
    const transport: jest.Mocked<CheckinTransport> = {
      fetchSignups: jest.fn().mockResolvedValue([{ id: 's1', name: 'Ana' }, { id: 's2', name: 'Bia' }]),
      checkin: jest.fn().mockImplementationOnce(() => new Promise((resolve) => (resolveFirstCheckin = resolve))).mockResolvedValue({ success: true }),
      walkin: jest.fn().mockResolvedValue({ success: true, signup: { id: 's9', name: 'C' } }),
    };
    const engine = new SyncEngine({ store, transport, connectivity: new FakeConnectivity(true), pullIntervalMs: 30_000 });

    engine.start('ev');
    await flush(); // initial pull merges s1+s2; outbox still empty
    store.checkIn('ev', 's1'); // no run in flight: starts one immediately
    await flush(); // that run pulls, then blocks inside processOutbox on the deferred checkin('s1')
    store.checkIn('ev', 's2'); // enqueued after this run's outbox snapshot was taken
    resolveFirstCheckin({ success: true });
    await flush();
    await flush(); // let the pendingRerun follow-up run (fetch + push s2) complete
    expect(transport.checkin).toHaveBeenCalledWith('ev', 's2', expect.any(String));
  });

  it('a run superseded by a same-slug restart sends no further outbox items', async () => {
    let nextId = 0;
    const store = new CheckinStore({ storage: new MemoryStorage(), uuid: () => `id${++nextId}` });
    store.loadEvent('ev', 'Evento', [{ id: 's1', name: 'Ana' }, { id: 's2', name: 'Bia' }]);
    store.checkIn('ev', 's1');
    store.checkIn('ev', 's2');
    let resolveFirstCheckin: (value: MutationResult) => void = () => {};
    const transport: jest.Mocked<CheckinTransport> = {
      fetchSignups: jest
        .fn()
        .mockResolvedValueOnce([{ id: 's1', name: 'Ana' }, { id: 's2', name: 'Bia' }])
        .mockImplementation(() => new Promise(() => {})), // the restarted run's pull never settles
      checkin: jest.fn().mockImplementationOnce(() => new Promise((resolve) => (resolveFirstCheckin = resolve))).mockResolvedValue({ success: true }),
      walkin: jest.fn().mockResolvedValue({ success: true, signup: { id: 's9', name: 'C' } }),
    };
    const engine = new SyncEngine({ store, transport, connectivity: new FakeConnectivity(true), pullIntervalMs: 30_000 });

    engine.start('ev');
    await flush(); // first run: pull done, blocked on checkin('s1')
    engine.start('ev'); // same slug (screen remount): supersedes the first run
    await flush();
    resolveFirstCheckin({ success: true });
    await flush();
    await flush();
    expect(transport.checkin).toHaveBeenCalledTimes(1);
    expect(transport.checkin).toHaveBeenCalledWith('ev', 's1', expect.any(String));
    expect(store.getEvent('ev')!.outbox.map((i) => i.kind === 'checkin' && i.signupId)).toEqual(['s2']);
  });

  it('pushes again when a failed item is retried from the settings screen', async () => {
    const { engine, transport, store } = make();
    transport.checkin.mockResolvedValueOnce({ success: false, message: 'Inscrição não encontrada.' });
    store.checkIn('ev', 's1');
    engine.start('ev');
    await flush();
    expect(store.getEvent('ev')!.outbox[0].failed).toBe(true);
    store.retryOutboxItem('ev', 'u');
    await flush();
    expect(transport.checkin).toHaveBeenCalledTimes(2);
    expect(store.getEvent('ev')!.outbox).toEqual([]);
  });

  it('stop() clears the syncing flag of an abandoned run', async () => {
    const { engine, transport } = make();
    transport.fetchSignups.mockImplementationOnce(() => new Promise(() => {}));
    engine.start('ev');
    await flush();
    expect(engine.getStatus().syncing).toBe(true);
    engine.stop();
    expect(engine.getStatus().syncing).toBe(false);
  });

  it('ignores results from a stale run when restarted with a different slug', async () => {
    const store = new CheckinStore({ storage: new MemoryStorage(), uuid: () => 'u' });
    store.loadEvent('a', 'Evento A', [{ id: 'a1', name: 'Ana' }]);
    store.loadEvent('b', 'Evento B', [{ id: 'b1', name: 'Bea' }]);
    let resolveA: (value: ServerSignup[]) => void = () => {};
    let resolveB: (value: ServerSignup[]) => void = () => {};
    const transport: jest.Mocked<CheckinTransport> = {
      fetchSignups: jest.fn((slug: string) => new Promise<ServerSignup[]>((resolve) => (slug === 'a' ? (resolveA = resolve) : (resolveB = resolve)))),
      checkin: jest.fn().mockResolvedValue({ success: true }),
      walkin: jest.fn().mockResolvedValue({ success: true, signup: { id: 's9', name: 'C' } }),
    };
    const engine = new SyncEngine({ store, transport, connectivity: new FakeConnectivity(true), pullIntervalMs: 30_000 });

    engine.start('a');
    await flush();
    engine.start('b');
    await flush();

    resolveA([{ id: 'a1', name: 'Ana', checked_in: true }]);
    resolveB([{ id: 'b1', name: 'Bea', checked_in: true }]);
    await flush();

    expect(transport.fetchSignups).toHaveBeenCalledWith('b');
    expect(store.getEvent('a')!.signups.find((s) => s.id === 'a1')!.checked_in).toBe(false);
    expect(store.getEvent('b')!.signups.find((s) => s.id === 'b1')!.checked_in).toBe(true);
    expect(engine.getStatus().lastSyncAt).toEqual(expect.any(String));
  });
});
