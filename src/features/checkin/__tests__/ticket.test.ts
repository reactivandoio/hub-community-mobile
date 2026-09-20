import { parseTicket, signupUrlFor } from '../ticket';
import { DEFAULT_SETTINGS } from '../types';

describe('parseTicket', () => {
  it('reads the ticket param from the web URL', () => {
    expect(parseTicket('https://hubcommunity.io/events/meetup/signup?ticket=abc123')).toBe('abc123');
    expect(parseTicket('https://x.io/e?utm=1&ticket=a%20b#frag')).toBe('a b');
  });

  it('accepts a bare id', () => {
    expect(parseTicket('  abc123\n')).toBe('abc123');
  });

  it('ignores URLs without a ticket, empty and free-text payloads', () => {
    expect(parseTicket('https://hubcommunity.io')).toBeNull();
    expect(parseTicket('https://x.io/?ticket=')).toBeNull();
    expect(parseTicket('')).toBeNull();
    expect(parseTicket('00020126 pix payload')).toBeNull();
  });
});

describe('signupUrlFor', () => {
  it('defaults to the event signup page', () => {
    expect(signupUrlFor({ slug: 'meetup 26', settings: DEFAULT_SETTINGS })).toBe('https://hubcommunity.io/events/meetup%2026/signup');
  });

  it('prefers the configured URL', () => {
    expect(signupUrlFor({ slug: 'meetup', settings: { ...DEFAULT_SETTINGS, signupUrl: ' https://forms.io/x ' } })).toBe('https://forms.io/x');
  });
});
