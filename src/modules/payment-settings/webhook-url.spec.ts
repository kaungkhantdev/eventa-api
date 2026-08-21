import { webhookUrlFor } from './webhook-url';

const BASE = 'https://api.eventa.test';
const TOKEN = 'aG9sZHRoaXN0b2tlbjEyMw';

/**
 * The URL an organizer pastes into Stripe to register their own endpoint.
 *
 * It has to be exactly right and it has to be stable. A wrong path means the
 * callback 404s and orders never settle; a URL that changes between visits
 * orphans the endpoint they already created, with the same result — and both
 * failures are silent, because the money still moves.
 */
describe('webhookUrlFor (US-SET-08)', () => {
  it('points at this workspace’s own endpoint, under the API prefix', () => {
    expect(webhookUrlFor(BASE, TOKEN)).toBe(
      `${BASE}/api/v1/public/payments/webhook/${TOKEN}`,
    );
  });

  // The base comes from config, where a trailing slash is an easy thing to
  // leave on — and `//api/v1` is not the route that is mapped.
  it('survives a base URL with a trailing slash', () => {
    expect(webhookUrlFor(`${BASE}/`, TOKEN)).toBe(
      `${BASE}/api/v1/public/payments/webhook/${TOKEN}`,
    );
  });

  it('survives several trailing slashes', () => {
    expect(webhookUrlFor(`${BASE}///`, TOKEN)).toBe(
      `${BASE}/api/v1/public/payments/webhook/${TOKEN}`,
    );
  });

  /**
   * Null until the first save mints one. Showing a half-formed URL would invite
   * an organizer to register an endpoint that can never resolve.
   */
  it('is null when no token has been minted yet', () => {
    expect(webhookUrlFor(BASE, null)).toBeNull();
  });

  it('is null for an empty token rather than a bare directory URL', () => {
    expect(webhookUrlFor(BASE, '')).toBeNull();
  });
});
