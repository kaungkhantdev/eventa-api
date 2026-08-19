import { OrganizationResponseDto } from './dto/organization-response.dto';
import type { OrganizationRow } from './organization.types';

/** Percent form of the stored numeric rate (`0.0700` → `7`) for display. */
function toPercent(rate: string): number {
  return Math.round(Number(rate) * 10000) / 100;
}

export function toOrganizationResponse(
  row: OrganizationRow,
): OrganizationResponseDto {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    logoUrl: row.logoUrl,
    address: row.address,
    website: row.website,
    taxId: row.taxId,
    currency: row.currency,
    country: row.country,
    timezone: row.timezone,
    locale: row.locale,
    vatRatePercent: toPercent(row.vatRate),
    statementDescriptor: row.statementDescriptor,
    version: row.version,
  };
}
