import type { CheckinStore } from './store';
import { NetworkError, type CheckinTransport, type MutationResult } from './transport';
import { isLocalId, type OutboxItem } from './types';

export interface OutboxReport {
  sent: number;
  failed: number;
  blocked: number;
  /** A network error interrupted the run; remaining items were not attempted. */
  stoppedByNetwork: boolean;
}

const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Pushes the event's outbox FIFO. Business failures mark the item and move on;
 * a network error stops the run (nothing else would get through either).
 */
export async function processOutbox(
  store: CheckinStore,
  slug: string,
  transport: CheckinTransport,
  now: () => string = () => new Date().toISOString(),
): Promise<OutboxReport> {
  const report: OutboxReport = { sent: 0, failed: 0, blocked: 0, stoppedByNetwork: false };
  const items = store.getEvent(slug)?.outbox ?? [];

  for (const item of items) {
    // Re-read the current item: a walk-in resolved earlier in this run may have
    // remapped a later check-in's signupId (the `items` snapshot is stale).
    const current = store.getEvent(slug)?.outbox.find((i) => i.id === item.id);
    if (!current) continue;

    if (current.failed || (current.nextAttemptAt && current.nextAttemptAt > now())) {
      report.blocked += 1;
      continue;
    }
    if (current.kind === 'checkin' && isLocalId(current.signupId)) {
      report.blocked += 1;
      continue;
    }
    if (current.kind === 'walkin' && !current.batchId) {
      store.outboxFailed(slug, current.id, 'Selecione o lote nas configurações', { permanent: true });
      report.failed += 1;
      continue;
    }

    let result: MutationResult;
    try {
      result = await send(current, slug, transport);
    } catch (e) {
      if (e instanceof NetworkError) {
        store.outboxFailed(slug, current.id, errorMessage(e), { permanent: false });
        report.stoppedByNetwork = true;
        return report;
      }
      store.outboxFailed(slug, current.id, errorMessage(e), { permanent: true });
      report.failed += 1;
      continue;
    }

    if (!result.success) {
      store.outboxFailed(slug, current.id, result.message || 'Falha no servidor', { permanent: true });
      report.failed += 1;
      continue;
    }
    if (current.kind === 'walkin') {
      if (!result.signup) {
        store.outboxFailed(slug, current.id, 'Servidor não devolveu a inscrição', { permanent: true });
        report.failed += 1;
        continue;
      }
      store.resolveWalkin(slug, current.localId, result.signup);
    }
    store.outboxSucceeded(slug, current.id);
    report.sent += 1;
  }
  return report;
}

const send = (item: OutboxItem, slug: string, transport: CheckinTransport): Promise<MutationResult> =>
  item.kind === 'checkin'
    ? transport.checkin(slug, item.signupId, item.checkedInAt)
    : transport.walkin(slug, item.batchId, item.input);
