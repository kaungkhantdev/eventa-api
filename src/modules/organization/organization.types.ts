import type { organizations } from '../../db/schema';

/** A workspace row as stored (never returned to a client — map to a DTO first). */
export type OrganizationRow = typeof organizations.$inferSelect;

/** The legal/branding fields an Admin may change (US-SET-07). */
export interface UpdateOrganizationInput {
  name?: string;
  address?: string | null;
  website?: string | null;
  taxId?: string | null;
  logoUrl?: string | null;
  timezone?: string;
  statementDescriptor?: string | null;
  /**
   * The version the caller's form was built from. Not a column to write — it
   * is compared, and the write is guarded by it.
   */
  version?: number;
}

/** Counts shown beside the logo — derived, never stored. */
export interface OrganizationSummary {
  eventsHosted: number;
  teamMembers: number;
}
