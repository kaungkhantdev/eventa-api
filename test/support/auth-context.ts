import type { AuthContext } from '../../src/modules/auth/auth.types';

/**
 * A signed-in organizer, for specs that call a service as somebody.
 *
 * Typed as `AuthContext` and built in one place, so when the context gains a
 * field this is the only thing that has to learn it. Hand-written literals in
 * each spec are how `persona` went missing from seven of them without anybody
 * noticing: ts-jest does not type-check, so the drift was invisible until
 * `tsc` was run over the tests.
 *
 * Pass what a spec's assertions depend on — the ids it checks were used — and
 * take the rest.
 */
export function organizerAuth(
  overrides: Partial<AuthContext> = {},
): AuthContext {
  return {
    userId: 'u1',
    organizationId: 1,
    sessionId: 's1',
    persona: 'admin',
    ...overrides,
  };
}
