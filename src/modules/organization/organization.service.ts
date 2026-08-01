import { Injectable } from '@nestjs/common';
import { DomainException } from '../../common/errors/domain.exception';
import { OrganizationResponseDto } from './dto/organization-response.dto';
import { toOrganizationResponse } from './organization.mapper';
import { OrganizationRepository } from './organization.repository';
import type {
  OrganizationRow,
  UpdateOrganizationInput,
} from './organization.types';

/** A Thai VAT registration number is exactly 13 digits. */
const THAI_TAX_ID = /^\d{13}$/;
/** Only http(s) — never a `javascript:`/`data:` URL on a branded surface. */
const HTTP_URL = /^https?:\/\/[^\s]+$/i;

/** Fields an Admin may change; anything else in the payload is ignored. */
const UPDATABLE_KEYS = [
  'name',
  'address',
  'website',
  'taxId',
  'logoUrl',
  'timezone',
  'statementDescriptor',
] as const satisfies readonly (keyof UpdateOrganizationInput)[];

/**
 * The workspace's legal identity, tax details and branding (US-SET-07). These
 * values are read when a document is *issued*; already-issued invoices/receipts
 * keep the details they were stamped with, so an edit only affects future ones.
 */
@Injectable()
export class OrganizationService {
  constructor(private readonly repo: OrganizationRepository) {}

  async get(organizationId: number): Promise<OrganizationResponseDto> {
    return toOrganizationResponse(await this.load(organizationId));
  }

  async update(
    organizationId: number,
    input: UpdateOrganizationInput,
  ): Promise<OrganizationResponseDto> {
    this.assertValid(input);
    const values = pickProvided(input);
    const saved = await this.repo.update(organizationId, values);
    if (!saved) throw DomainException.notFound('Workspace not found.');
    return toOrganizationResponse(saved);
  }

  private assertValid(input: UpdateOrganizationInput): void {
    if (input.taxId != null && !THAI_TAX_ID.test(input.taxId)) {
      throw DomainException.validation(
        'Tax ID must be the 13-digit Thai VAT registration number.',
      );
    }
    if (input.website != null && !HTTP_URL.test(input.website)) {
      throw DomainException.validation(
        'Website must be a valid http(s) address.',
      );
    }
  }

  private async load(organizationId: number): Promise<OrganizationRow> {
    const row = await this.repo.find(organizationId);
    if (!row) throw DomainException.notFound('Workspace not found.');
    return row;
  }
}

/** Only the keys actually present — so a partial save never blanks the others. */
function pickProvided(
  input: UpdateOrganizationInput,
): Partial<OrganizationRow> {
  const values: Record<string, unknown> = {};
  for (const key of UPDATABLE_KEYS) {
    if (input[key] !== undefined) values[key] = input[key];
  }
  return values;
}
