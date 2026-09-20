import { print } from 'graphql';
import { EVENTS } from '../queries';

describe('EVENTS', () => {
  // The BFF hides `unlisted` events from `events` by default, which is right for
  // the public site and wrong here: without this the operator cannot open the
  // event at the door, so kiosk mode is unreachable for exactly the private
  // events that need a totem.
  it('asks for the unlisted events too', () => {
    expect(print(EVENTS)).toContain('include_unlisted: true');
  });
});
