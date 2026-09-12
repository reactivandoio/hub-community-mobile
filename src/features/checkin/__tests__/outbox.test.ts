import { processOutbox } from '../outbox';
import { CheckinStore, MemoryStorage } from '../store';
import { NetworkError, type CheckinTransport } from '../transport';

const make = (nowIso = '2026-09-12T10:00:00.000Z') => {
  let n = 0;
  const store = new CheckinStore({ storage: new MemoryStorage(), now: () => nowIso, uuid: () => `u${++n}` });
  store.loadEvent('ev', 'Evento', [{ id: 's1', name: 'Ana' }]);
  store.updateSettings('ev', { batchId: '7' });
  const transport: jest.Mocked<CheckinTransport> = {
    fetchSignups: jest.fn(),
    checkin: jest.fn().mockResolvedValue({ success: true }),
    walkin: jest.fn().mockResolvedValue({ success: true, signup: { id: 's9', name: 'Caio' } }),
  };
  return { store, transport };
};

describe('processOutbox', () => {
  it('sends check-ins in order and removes them', async () => {
    const { store, transport } = make();
    store.checkIn('ev', 's1');
    const report = await processOutbox(store, 'ev', transport);
    expect(transport.checkin).toHaveBeenCalledWith('ev', 's1', '2026-09-12T10:00:00.000Z');
    expect(store.getEvent('ev')!.outbox).toEqual([]);
    expect(report).toEqual({ sent: 1, failed: 0, blocked: 0, stoppedByNetwork: false });
  });

  it('resolves a walk-in then sends its check-in with the server id', async () => {
    const { store, transport } = make();
    const w = store.addWalkin('ev', { name: 'Caio', email: 'c@x.io' });
    store.checkIn('ev', w.id);
    const report = await processOutbox(store, 'ev', transport);
    expect(transport.walkin).toHaveBeenCalledWith('ev', '7', { name: 'Caio', email: 'c@x.io' });
    expect(transport.checkin).toHaveBeenCalledWith('ev', 's9', '2026-09-12T10:00:00.000Z');
    expect(report.sent).toBe(2);
    expect(store.getEvent('ev')!.signups.find((s) => s.id === 's9')?.checked_in).toBe(true);
  });

  it('blocks a check-in whose walk-in has not been resolved yet', async () => {
    const { store, transport } = make();
    transport.walkin.mockResolvedValue({ success: false, message: 'E-mail inválido' });
    const w = store.addWalkin('ev', { name: 'Caio', email: 'nope' });
    store.checkIn('ev', w.id);
    const report = await processOutbox(store, 'ev', transport);
    expect(transport.checkin).not.toHaveBeenCalled();
    expect(report).toEqual({ sent: 0, failed: 1, blocked: 1, stoppedByNetwork: false });
    expect(store.getEvent('ev')!.outbox[0]).toMatchObject({ kind: 'walkin', failed: true, lastError: 'E-mail inválido' });
  });

  it('stops at the first network error and keeps the item for retry', async () => {
    const { store, transport } = make();
    transport.checkin.mockRejectedValueOnce(new NetworkError('offline'));
    store.checkIn('ev', 's1');
    const w = store.addWalkin('ev', { name: 'Caio', email: 'c@x.io' });
    void w;
    const report = await processOutbox(store, 'ev', transport);
    expect(report).toEqual({ sent: 0, failed: 0, blocked: 0, stoppedByNetwork: true });
    expect(transport.walkin).not.toHaveBeenCalled();
    expect(store.getEvent('ev')!.outbox[0]).toMatchObject({ attempts: 1, lastError: 'offline', nextAttemptAt: '2026-09-12T10:00:05.000Z' });
  });

  it('skips items in backoff and failed items', async () => {
    const { store, transport } = make();
    store.checkIn('ev', 's1');
    const [item] = store.getEvent('ev')!.outbox;
    store.outboxFailed('ev', item.id, 'x', { permanent: false });
    const report = await processOutbox(store, 'ev', transport, () => '2026-09-12T10:00:00.000Z');
    expect(transport.checkin).not.toHaveBeenCalled();
    expect(report.blocked).toBe(1);
  });

  it('fails a walk-in permanently when no batch is configured', async () => {
    const { store, transport } = make();
    store.updateSettings('ev', { batchId: '' });
    store.addWalkin('ev', { name: 'Caio', email: 'c@x.io' });
    await processOutbox(store, 'ev', transport);
    expect(transport.walkin).not.toHaveBeenCalled();
    expect(store.getEvent('ev')!.outbox[0]).toMatchObject({ failed: true, lastError: 'Selecione o lote nas configurações' });
  });

  it('treats unknown errors as permanent failures', async () => {
    const { store, transport } = make();
    transport.checkin.mockRejectedValueOnce(new Error('GraphQL boom'));
    store.checkIn('ev', 's1');
    const report = await processOutbox(store, 'ev', transport);
    expect(report.failed).toBe(1);
    expect(store.getEvent('ev')!.outbox[0]).toMatchObject({ failed: true, lastError: 'GraphQL boom' });
  });
});
