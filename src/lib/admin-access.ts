/**
 * Who may open the event management menu (check-in, walk-in, kiosk) — REA-58.
 *
 * Same rules as the BFF (`src/utils/auth`: canAccessAdmin, isEventOrganizer) and as the web's
 * `lib/admin-access.ts`, read from the `adminAccess` query:
 * - admin: every event;
 * - community-manager: the events of the communities it organizes, plus the ones it was invited
 *   to manage (`access.events`);
 * - event-manager (REA-48): only the events it manages (`access.events`);
 * - anyone else: no menu at all.
 *
 * This only decides what the app shows. The real protection is the BFF: eventSignups,
 * checkinSignup and manualSignup all run requireEventOrganizer for the event in the call.
 */

export interface AdminRef {
  id: string;
  title?: string | null;
  slug?: string | null;
}

export interface AdminAccess {
  role: string | null;
  isAdmin: boolean;
  isCommunityManager: boolean;
  isEventManager?: boolean;
  canAccessAdmin: boolean;
  communities: AdminRef[];
  events?: AdminRef[] | null;
}

export interface ManageableEvent {
  id?: string | null;
  documentId?: string | null;
  slug?: string | null;
  communities?: { id: string }[] | null;
}

/** Admin, community manager or event manager: the management menu shows up. */
export const canManageEvents = (access: AdminAccess | null | undefined): access is AdminAccess =>
  Boolean(access?.canAccessAdmin);

const managedEventKeys = (access: AdminAccess) =>
  new Set((access.events ?? []).flatMap((e) => [e.id, e.slug]).filter((k): k is string => Boolean(k)));

/** Can this user manage this event? Mirrors the BFF's isEventOrganizer. */
export const managesEvent = (access: AdminAccess | null | undefined, event: ManageableEvent): boolean => {
  if (!canManageEvents(access)) return false;
  if (access.isAdmin) return true;
  const keys = managedEventKeys(access);
  if ([event.id, event.documentId, event.slug].some((k) => !!k && keys.has(k))) return true;
  // Organizing a community counts only with the community-manager role (the BFF ignores it
  // otherwise), and adminAccess lists communities only for that role.
  if (!access.isCommunityManager) return false;
  const communities = new Set(access.communities.map((c) => c.id));
  return (event.communities ?? []).some((c) => communities.has(c.id));
};

/** The events of the list this user may manage, in the same order. */
export const manageableEvents = <T extends ManageableEvent>(access: AdminAccess | null | undefined, events: T[]): T[] =>
  events.filter((event) => managesEvent(access, event));

export const ROLE_LABELS: Record<string, string> = {
  authenticated: 'Participante',
  'event-manager': 'Event Manager',
  'community-manager': 'Community Manager',
  admin: 'Admin',
};

export const roleLabel = (role: string | null | undefined) => (role && ROLE_LABELS[role]) || 'Participante';
