import { sql, type SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { organizations } from './schema';

/** The three seller columns an issued document is stamped with. */
interface SellerColumns {
  sellerName: AnyPgColumn;
  sellerAddress: AnyPgColumn;
  sellerTaxId: AnyPgColumn;
}

/**
 * The seller identity an issued document shows (US-SET-07): "Given a document
 * was already issued, when I later change the organization details, then that
 * past document is unchanged and only future documents use the new details."
 *
 * `invoices` and `payments` (the attendee's receipt) copy these from
 * `organizations` when the document is issued, and this reads the copy, never
 * the live row. The query must join `organizations` all the same: a row that
 * was never stamped (`seller_name` NULL) falls back to it. The fallback is
 * decided by the name alone, never field by field, so an address or tax ID
 * that was blank on issue stays blank after the workspace fills it in.
 */
export function stampedSeller(doc: SellerColumns): {
  sellerName: SQL<string>;
  sellerAddress: SQL<string | null>;
  sellerTaxId: SQL<string | null>;
} {
  const stamped = sql`${doc.sellerName} IS NOT NULL`;
  return {
    sellerName: sql<string>`coalesce(${doc.sellerName}, ${organizations.name})`,
    sellerAddress: sql<
      string | null
    >`CASE WHEN ${stamped} THEN ${doc.sellerAddress} ELSE ${organizations.address} END`,
    sellerTaxId: sql<
      string | null
    >`CASE WHEN ${stamped} THEN ${doc.sellerTaxId} ELSE ${organizations.taxId} END`,
  };
}
