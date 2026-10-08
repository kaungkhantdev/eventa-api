import { Injectable } from '@nestjs/common';
import { DomainException } from '../../common/errors/domain.exception';
import {
  UQ_ORGANIZATIONS_NAME,
  isUniqueViolation,
} from '../../common/errors/unique-violation';
import { OrganizationResponseDto } from './dto/organization-response.dto';
import { toOrganizationResponse } from './organization.mapper';
import { OrganizationRepository } from './organization.repository';
import type {
  OrganizationRow,
  UpdateOrganizationInput,
  OrganizationSummary,
} from './organization.types';

/** A Thai VAT registration number is exactly 13 digits. */
const THAI_TAX_ID = /^\d{13}$/;
/** Only http(s) — never a `javascript:`/`data:` URL on a branded surface. */
const HTTP_URL = /^https?:\/\/[^\s]+$/i;

const NAME_TAKEN_MESSAGE = 'That workspace name is already taken. Try another.';

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

  /**
   * The figures beside the logo (US-SET-06).
   *
   * Deliberately NOT on `get`: those are the editable profile, these are counts
   * of other tables. Keeping them apart means a save of the profile does not
   * have to recount anything, and neither call answers a question it was not
   * asked.
   *
   * There is no plan or tier here, and the kit's "Pro" badge has no counterpart:
   * this product has no billing concept, so showing one would be a claim about
   * the workspace that nothing backs.
   */
  async summarise(organizationId: number): Promise<OrganizationSummary> {
    return this.repo.summarise(organizationId);
  }

  async get(organizationId: number): Promise<OrganizationResponseDto> {
    return toOrganizationResponse(await this.load(organizationId));
  }

  async update(
    organizationId: number,
    input: UpdateOrganizationInput,
  ): Promise<OrganizationResponseDto> {
    this.assertValid(input);
    // Read first, so the version the write is guarded by is the row's own and
    // not the caller's word for it.
    const current = await this.load(organizationId);
    if (input.version !== undefined && input.version !== current.version) {
      throw this.stale();
    }
    // Only when it is actually changing: saving the form untouched must not
    // refuse the name the workspace already holds.
    if (
      input.name !== undefined &&
      (await this.repo.nameTaken(input.name, organizationId))
    ) {
      throw DomainException.conflict(NAME_TAKEN_MESSAGE);
    }
    const values = pickProvided(input);
    // The name can be taken between the check above and this write; the index
    // is what stops it, and its refusal is the same answer, not a 500.
    const saved = await this.writeOrRefuse(
      organizationId,
      values,
      current.version,
    );
    // The guarded UPDATE matched nothing: the row moved between the read and
    // the write, which is the same fact as a form opened too long ago.
    if (!saved) throw this.stale();
    return toOrganizationResponse(saved);
  }

  private async writeOrRefuse(
    organizationId: number,
    values: Partial<OrganizationRow>,
    currentVersion: number,
  ): Promise<OrganizationRow | null> {
    try {
      return await this.repo.update(organizationId, values, currentVersion);
    } catch (cause) {
      if (isUniqueViolation(cause, UQ_ORGANIZATIONS_NAME)) {
        throw DomainException.conflict(NAME_TAKEN_MESSAGE);
      }
      throw cause;
    }
  }

  private stale(): DomainException {
    return DomainException.conflict(
      'This workspace changed elsewhere. Reload and try again.',
    );
  }

  private assertValid(input: UpdateOrganizationInput): void {
    // Named fields, not bare sentences: the form puts each under the input it
    // is about, and a client never has to match on the message text — which
    // would stop working the moment this copy is translated.
    if (input.taxId != null && !THAI_TAX_ID.test(input.taxId)) {
      throw DomainException.invalidField(
        'taxId',
        'Tax ID must be the 13-digit Thai VAT registration number.',
      );
    }
    if (input.website != null && !HTTP_URL.test(input.website)) {
      throw DomainException.invalidField(
        'website',
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
