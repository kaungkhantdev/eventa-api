import { liveKeysAccepted, whyLiveRefused } from './live-keys';

/**
 * Where a real card may be charged.
 *
 * This was a private check inside PaymentKeysService, which meant the screen
 * offering a Live toggle had no way to know the server would refuse it. Shared
 * now, so the answer the API gives the page and the answer it enforces on save
 * cannot drift apart.
 */
describe('liveKeysAccepted', () => {
  it('accepts live keys only in production', () => {
    expect(liveKeysAccepted('production')).toBe(true);
  });

  it('refuses them everywhere else', () => {
    // A live key on a developer's machine means a seed script or somebody
    // clicking round staging can charge a real person's card.
    expect(liveKeysAccepted('development')).toBe(false);
    expect(liveKeysAccepted('test')).toBe(false);
    expect(liveKeysAccepted('staging')).toBe(false);
  });

  /** Nothing is "close enough" to production when a real card is at stake. */
  it('is not fooled by something production-ish', () => {
    expect(liveKeysAccepted('Production')).toBe(false);
    expect(liveKeysAccepted('production-eu')).toBe(false);
    expect(liveKeysAccepted('')).toBe(false);
  });
});

describe('whyLiveRefused', () => {
  it('names the environment, so the reason is checkable', () => {
    // "Live keys are not allowed" invites an argument; naming what the server
    // thinks it is tells them whether the machine or the toggle is wrong.
    expect(whyLiveRefused('development')).toContain('development');
  });

  it('points at the keys that WILL work here', () => {
    expect(whyLiveRefused('development')).toMatch(/test keys/i);
  });
});
