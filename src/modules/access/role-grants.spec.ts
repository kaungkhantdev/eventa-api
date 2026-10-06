import { roleGrantStates } from './role-grants';

/**
 * The three states a role can be in about a permission key, which is the whole
 * of what the roles editor has to be able to draw.
 *
 * Nothing grants a permission automatically any more: two automatic backfills
 * were tried and both reversed decisions organizers had made, because a key
 * with no row could mean either "never offered" or "revoked before removals
 * were recorded". The fix is to stop guessing and show the gap to a person — so
 * the gap has to be a state the API reports, not one a client infers.
 *
 *   granted = true   the role holds the key
 *   granted = false  somebody turned it off — a decision, to be left alone
 *   no row at all    nobody here has ever been asked about this key
 */
describe('roleGrantStates', () => {
  const CATALOG = ['evCreate', 'regView', 'finManage', 'setUsers'];

  it('reports a key with no row as never offered', () => {
    const states = roleGrantStates(CATALOG, [
      { key: 'evCreate', granted: true },
    ]);

    expect(states.neverOffered).toEqual(['regView', 'finManage', 'setUsers']);
  });

  it('reports a key with a granted row as held, and not as never offered', () => {
    const states = roleGrantStates(CATALOG, [
      { key: 'evCreate', granted: true },
    ]);

    expect(states.granted).toEqual(['evCreate']);
    expect(states.neverOffered).not.toContain('evCreate');
  });

  /**
   * The distinction the whole design turns on. A `granted = false` row is an
   * organizer's decision, so it is neither held nor an open question — reported
   * as never offered it would be handed back to them as a gap to close, which
   * is exactly the reversal that got the backfill withdrawn.
   */
  it('reports a key turned off as neither held nor never offered', () => {
    const states = roleGrantStates(CATALOG, [
      { key: 'evCreate', granted: false },
    ]);

    expect(states.granted).not.toContain('evCreate');
    expect(states.neverOffered).not.toContain('evCreate');
  });

  it('accounts for every catalog key, and never for the same one twice', () => {
    const states = roleGrantStates(CATALOG, [
      { key: 'evCreate', granted: true },
      { key: 'regView', granted: false },
    ]);

    expect([...states.granted, ...states.neverOffered].sort()).toEqual(
      ['evCreate', 'finManage', 'setUsers'].sort(),
    );
  });

  // A role nobody has ever edited: its grants came out of the default matrix,
  // which is the product's choice and not a decision anybody here made, so
  // every key it does not hold is still an open question.
  it('reports the whole catalog as never offered for a role with no rows', () => {
    expect(roleGrantStates(CATALOG, []).neverOffered).toEqual(CATALOG);
  });

  // Catalog order, not the order rows happened to come back in: the editor
  // lists permissions by group, and a set that reshuffled between two reads
  // would make the gap look like it had changed.
  it('keeps the catalog’s own order', () => {
    const states = roleGrantStates(CATALOG, [
      { key: 'finManage', granted: true },
    ]);

    expect(states.neverOffered).toEqual(['evCreate', 'regView', 'setUsers']);
  });
});
