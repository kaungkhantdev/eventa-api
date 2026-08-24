/** The one environment where charging a real card is the intended outcome. */
const PRODUCTION = 'production';

/**
 * Whether this server will accept a workspace's LIVE Stripe keys.
 *
 * Outside production a live key means a seed script, a test run, or somebody
 * clicking around a staging box can charge a real card belonging to a real
 * person — and nothing on the screen would show it had happened.
 *
 * Shared rather than private to the save path, because the settings screen
 * offers a Test/Live toggle and had no way to know the server would refuse the
 * live half. One function, so what the API tells the page and what it enforces
 * on save cannot drift.
 */
export function liveKeysAccepted(environment: string): boolean {
  return environment === PRODUCTION;
}

/** Why the live half is closed here — naming the environment, so it is checkable. */
export function whyLiveRefused(environment: string): string {
  return `Live keys are only accepted in production; this server is running as "${environment}". Use your Stripe test keys here.`;
}
