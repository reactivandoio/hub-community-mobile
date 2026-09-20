// Ticket QR contract shared with the web (hub-community-frontend/src/lib/ticket.ts):
//   https://hubcommunity.io/events/<slug>/signup?ticket=<signupId>
// The kiosk only needs the signup id, so the parser is lenient about the rest.

import type { EventCache } from './types';

export const TICKET_PARAM = 'ticket';
export const DEFAULT_SITE_URL = 'https://hubcommunity.io';

/**
 * Extracts the signup id from a scanned payload: the `ticket` query param of
 * any URL, or the raw payload when it is not a URL (a bare id). Returns null
 * for URLs without a ticket and for empty payloads, so random QR codes (PIX,
 * a website) don't trigger a lookup.
 */
export function parseTicket(payload: string): string | null {
  const text = payload.trim();
  if (!text) return null;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) {
    const query = text.split('#')[0].split('?')[1] ?? '';
    for (const pair of query.split('&')) {
      const [key, ...rest] = pair.split('=');
      if (key !== TICKET_PARAM) continue;
      const value = decodeURIComponent(rest.join('=')).trim();
      return value || null;
    }
    return null;
  }
  if (/\s/.test(text)) return null;
  return text;
}

/** Where the "not signed up yet" QR sends people: the event's configured URL or the default signup page. */
export function signupUrlFor(event: Pick<EventCache, 'slug' | 'settings'>): string {
  const configured = event.settings.signupUrl?.trim();
  return configured || `${DEFAULT_SITE_URL}/events/${encodeURIComponent(event.slug)}/signup`;
}
