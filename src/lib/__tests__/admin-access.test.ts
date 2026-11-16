import { canManageEvents, manageableEvents, managesEvent, roleLabel, type AdminAccess } from '../admin-access';

const base: AdminAccess = {
  role: 'authenticated',
  isAdmin: false,
  isCommunityManager: false,
  isEventManager: false,
  canAccessAdmin: false,
  communities: [],
  events: [],
};
const admin: AdminAccess = { ...base, role: 'admin', isAdmin: true, canAccessAdmin: true };
const communityManager: AdminAccess = {
  ...base,
  role: 'community-manager',
  isCommunityManager: true,
  canAccessAdmin: true,
  communities: [{ id: 'c-1' }],
  events: [{ id: 'ev-guest', slug: 'convidado' }],
};
const eventManager: AdminAccess = {
  ...base,
  role: 'event-manager',
  isEventManager: true,
  canAccessAdmin: true,
  events: [{ id: 'ev-2', slug: 'meetup-2' }],
};

const events = [
  { id: 'ev-1', documentId: 'ev-1', slug: 'meetup-1', communities: [{ id: 'c-1' }] },
  { id: 'ev-2', documentId: 'ev-2', slug: 'meetup-2', communities: [{ id: 'c-2' }] },
  { id: 'ev-3', documentId: 'ev-3', slug: 'meetup-3', communities: [{ id: 'c-3' }] },
  { id: 'ev-guest', documentId: 'ev-guest', slug: 'convidado', communities: [{ id: 'c-9' }] },
];
const slugs = (access: AdminAccess | null) => manageableEvents(access, events).map((e) => e.slug);

describe('canManageEvents', () => {
  it('opens the menu to admin, community manager and event manager only', () => {
    expect(canManageEvents(admin)).toBe(true);
    expect(canManageEvents(communityManager)).toBe(true);
    expect(canManageEvents(eventManager)).toBe(true);
    expect(canManageEvents(base)).toBe(false);
    expect(canManageEvents(null)).toBe(false);
  });
});

describe('manageableEvents (same rule as the BFF isEventOrganizer)', () => {
  it('gives the admin every event', () => {
    expect(slugs(admin)).toEqual(['meetup-1', 'meetup-2', 'meetup-3', 'convidado']);
  });

  it('gives a community manager its communities plus the events it was invited to', () => {
    expect(slugs(communityManager)).toEqual(['meetup-1', 'convidado']);
  });

  it('gives an event manager only the events it manages', () => {
    expect(slugs(eventManager)).toEqual(['meetup-2']);
  });

  it('gives a participant nothing, even if listed somewhere', () => {
    expect(slugs({ ...base, communities: [{ id: 'c-1' }], events: [{ id: 'ev-2' }] })).toEqual([]);
    expect(slugs(null)).toEqual([]);
  });

  it('ignores communities for an event manager (the BFF needs the community-manager role)', () => {
    expect(slugs({ ...eventManager, communities: [{ id: 'c-3' }] })).toEqual(['meetup-2']);
  });

  it('matches a loaded event by slug alone', () => {
    expect(managesEvent(eventManager, { slug: 'meetup-2' })).toBe(true);
    expect(managesEvent(eventManager, { slug: 'meetup-1' })).toBe(false);
  });
});

describe('roleLabel', () => {
  it('names the roles', () => {
    expect(roleLabel('event-manager')).toBe('Event Manager');
    expect(roleLabel('authenticated')).toBe('Participante');
    expect(roleLabel(null)).toBe('Participante');
  });
});
