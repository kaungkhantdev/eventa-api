import { DrizzleQueryError } from 'drizzle-orm';
import { isUniqueViolation } from './unique-violation';

/**
 * What the driver stack ACTUALLY throws, which is the whole point of this file.
 *
 * Two layers, and the previous fixture modelled neither. node-postgres puts the
 * constraint on `constraint` — `pg-protocol`'s parser does
 * `message.constraint = fields.n`, and there is no `constraint_name` anywhere in
 * it. Drizzle then wraps every query rejection:
 * `throw new DrizzleQueryError(queryString, params, e)` in
 * `drizzle-orm/pg-core/session`, so the pg error is at `.cause` and the thrown
 * object has no `code` of its own.
 *
 * The old fixture built a flat `{ code, constraint_name }` and the guard read
 * exactly that, so the spec and the bug agreed with each other and the suite
 * stayed green while no real violation was ever recognised.
 *
 * `DrizzleQueryError` is the real class, imported rather than imitated, so a
 * future change to how drizzle wraps shows up here as a failure instead of as a
 * 500 in production.
 */
function driverError(fields: { code?: string; constraint?: string }): Error {
  const pg = Object.assign(
    new Error('duplicate key value violates unique constraint'),
    fields,
  );
  // The params drizzle interpolates into its message are the bound values —
  // which is why nothing here may reach a log. See the guard's own docstring.
  return new DrizzleQueryError(
    'update "attendees" set "email" = $1 where "id" = $2',
    ['malee@example.com', '42'],
    pg,
  );
}

/** The same rejection as it arrives from a raw pool query, with no wrapper. */
function bareError(fields: { code?: string; constraint?: string }): Error {
  return Object.assign(new Error('duplicate key value'), fields);
}

describe('isUniqueViolation', () => {
  it('recognises the named index through drizzle’s wrapper', () => {
    expect(
      isUniqueViolation(
        driverError({ code: '23505', constraint: 'uq_organizations_name' }),
        'uq_organizations_name',
      ),
    ).toBe(true);
  });

  // Not every query goes through drizzle's session wrapper; a raw pool query
  // rejects with the pg error itself.
  it('recognises it on an unwrapped pg rejection too', () => {
    expect(
      isUniqueViolation(
        bareError({ code: '23505', constraint: 'uq_attendees_org_email' }),
        'uq_attendees_org_email',
      ),
    ).toBe(true);
  });

  /**
   * Named, never "any 23505". Two constraints on one statement mean two
   * different things to the person reading the message, and answering a
   * duplicate slug with "that workspace name is taken" would send them to
   * change a field that was never the problem.
   */
  it('ignores a violation of a different index', () => {
    expect(
      isUniqueViolation(
        driverError({ code: '23505', constraint: 'uq_organizations_slug' }),
        'uq_organizations_name',
      ),
    ).toBe(false);
  });

  it('ignores an error that is not a unique violation at all', () => {
    expect(
      isUniqueViolation(
        driverError({ code: '23503', constraint: 'uq_organizations_name' }),
        'uq_organizations_name',
      ),
    ).toBe(false);
  });

  it('is safe on anything that is not a database error', () => {
    expect(isUniqueViolation(new Error('boom'), 'uq_organizations_name')).toBe(
      false,
    );
    expect(isUniqueViolation(null, 'uq_organizations_name')).toBe(false);
    expect(isUniqueViolation('a string', 'uq_organizations_name')).toBe(false);
    expect(isUniqueViolation(undefined, 'uq_organizations_name')).toBe(false);
  });
});
