import type { LocalSignup, ServerSignup } from './types';
import { isLocalId } from './types';

const fromServer = (s: ServerSignup): LocalSignup => ({
  id: s.id,
  name: s.name,
  email: s.email ?? undefined,
  phone_number: s.phone_number ?? undefined,
  product_name: s.product_name ?? undefined,
  checked_in: Boolean(s.checked_in),
  checked_in_at: s.checked_in_at ?? undefined,
  source: 'server',
});

/**
 * Server list wins for data; check-in is monotonic (local OR server) and a local
 * check-in keeps its own time. Server signups missing from `server` are dropped;
 * unsynced walk-ins (`local:` ids) are kept at the end.
 */
export function mergeSignups(local: LocalSignup[], server: ServerSignup[]): LocalSignup[] {
  const byId = new Map(local.map((s) => [s.id, s]));
  const merged = server.map((raw) => {
    const next = fromServer(raw);
    const prev = byId.get(raw.id);
    if (!prev) return next;
    return {
      ...next,
      checked_in: prev.checked_in || next.checked_in,
      checked_in_at: prev.checked_in ? prev.checked_in_at : next.checked_in_at,
      printed_at: prev.printed_at,
      source: prev.source,
    };
  });
  const walkins = local.filter((s) => isLocalId(s.id));
  return [...merged, ...walkins];
}

export const normalize = (text: string): string =>
  text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();

export function matchesSearch(signup: LocalSignup, query: string): boolean {
  const q = normalize(query);
  if (!q) return true;
  return normalize(signup.name).includes(q) || normalize(signup.email ?? '').includes(q);
}
