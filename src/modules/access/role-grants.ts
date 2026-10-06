/** One recorded decision about a key: present and true, or present and false. */
export interface RoleGrantRow {
  readonly key: string;
  readonly granted: boolean;
}

/** What a role holds, and what nobody here has decided about yet. */
export interface RoleGrantStates {
  readonly granted: string[];
  readonly neverOffered: string[];
}

/**
 * Split a role's rows into the two states a client has to be told apart from
 * the third.
 *
 * `role_permissions` carries three states, and the gap between them is why the
 * automatic backfill was withdrawn: a row saying `granted = true` means the
 * role holds the key, a row saying `granted = false` means an organizer turned
 * it off, and NO ROW means nobody here has ever been asked. The first two are
 * decisions and belong to the workspace; the third is an open question, and
 * since nothing grants a permission automatically any more it has to reach the
 * roles editor, where a person closes it.
 *
 * A refusal is deliberately in neither list. It is reported by its absence from
 * both — which is what keeps "turned off" from being handed back to an
 * organizer as a gap to fill, the very reversal this replaced.
 *
 * The catalog decides the order and the membership: a key is never-offered only
 * if the catalog has it, so a key dropped from the catalog cannot appear as an
 * open question nobody can answer.
 */
export function roleGrantStates(
  catalogKeys: readonly string[],
  rows: readonly RoleGrantRow[],
): RoleGrantStates {
  const decided = new Set(rows.map((row) => row.key));
  return {
    granted: rows.filter((row) => row.granted).map((row) => row.key),
    neverOffered: catalogKeys.filter((key) => !decided.has(key)),
  };
}
