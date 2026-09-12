import { ApolloClient, ApolloLink, InMemoryCache, Observable } from '@apollo/client';
import { createApolloTransport } from '../apollo-transport';
import { NetworkError } from '../transport';

const clientWith = (link: ApolloLink) => new ApolloClient({ link, cache: new InMemoryCache({ addTypename: false }) });

describe('createApolloTransport', () => {
  it('maps eventSignups to ServerSignup[] with network-only fetch', async () => {
    const link = new ApolloLink((op) => {
      expect(op.operationName).toBe('EventSignups');
      expect(op.variables).toEqual({ eventSlug: 'ev' });
      return Observable.of({ data: { eventSignups: [{ id: '1', name: 'Ana', email: null, phone_number: null, checked_in: false, checked_in_at: null, product_name: null }] } });
    });
    const out = await createApolloTransport(clientWith(link)).fetchSignups('ev');
    expect(out).toEqual([{ id: '1', name: 'Ana', email: null, phone_number: null, checked_in: false, checked_in_at: null, product_name: null }]);
  });

  it('sends checkin and walkin mutations and returns their payloads', async () => {
    const link = new ApolloLink((op) => {
      if (op.operationName === 'CheckinSignup') {
        expect(op.variables).toEqual({ eventSlug: 'ev', signupId: 's1', checkedInAt: 't' });
        return Observable.of({ data: { checkinSignup: { success: true, message: 'ok', signup: null } } });
      }
      expect(op.variables).toEqual({ eventSlug: 'ev', batchId: '7', input: { name: 'C', email: 'c@x.io', phone_number: '62' } });
      return Observable.of({ data: { manualSignup: { success: true, message: null, account_created: true, signup: { id: 's9', name: 'C' } } } });
    });
    const t = createApolloTransport(clientWith(link));
    expect(await t.checkin('ev', 's1', 't')).toEqual({ success: true, message: 'ok', signup: null });
    expect(await t.walkin('ev', '7', { name: 'C', email: 'c@x.io', phone_number: '62' })).toMatchObject({ success: true, signup: { id: 's9' } });
  });

  it('turns transport failures into NetworkError', async () => {
    const link = new ApolloLink(() => new Observable((o) => o.error(new TypeError('Network request failed'))));
    await expect(createApolloTransport(clientWith(link)).checkin('ev', 's1', 't')).rejects.toBeInstanceOf(NetworkError);
  });

  it('keeps GraphQL errors as plain errors', async () => {
    const link = new ApolloLink(() => Observable.of({ errors: [{ message: 'Unknown argument' }] } as never));
    await expect(createApolloTransport(clientWith(link)).checkin('ev', 's1', 't')).rejects.toThrow('Unknown argument');
  });
});
