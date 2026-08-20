import { isUniqueViolation } from './unique-violation';

/** A node-postgres rejection, whose `code` is the SQLSTATE. */
function pgError(fields: { code?: string; constraint_name?: string }): Error {
  return Object.assign(new Error('duplicate key value'), fields);
}

describe('isUniqueViolation', () => {
  it('recognises the named index it was asked about', () => {
    expect(
      isUniqueViolation(
        pgError({ code: '23505', constraint_name: 'uq_organizations_name' }),
        'uq_organizations_name',
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
        pgError({ code: '23505', constraint_name: 'uq_organizations_slug' }),
        'uq_organizations_name',
      ),
    ).toBe(false);
  });

  it('ignores an error that is not a unique violation at all', () => {
    expect(
      isUniqueViolation(
        pgError({ code: '23503', constraint_name: 'uq_organizations_name' }),
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
  });
});
