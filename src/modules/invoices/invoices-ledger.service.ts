import { Injectable } from '@nestjs/common';
import { DomainException } from '../../common/errors/domain.exception';
import { Paginated } from '../../common/http/paginated';
import { Clock } from '../../common/time/clock';
import type { AuthContext } from '../auth/auth.types';
import {
  DEFAULT_LIMIT,
  type InvoiceCountsDto,
  type InvoiceDetailDto,
  type InvoiceEntryDto,
  MAX_LIMIT,
} from './dto/list-invoices.dto';
import { bangkokToday } from './invoice-ageing';
import { renderInvoiceSvg } from './invoice.svg';
import { toInvoiceDetail, toInvoiceEntry } from './invoices.mapper';
import { InvoicesRepository } from './invoices.repository';
import type { InvoiceFilters } from './invoices.types';

export interface ListInvoicesQuery {
  page?: number;
  limit?: number;
  status?: InvoiceFilters['status'];
  eventId?: string;
  search?: string;
}

/**
 * Reading the invoice ledger (US-FIN-06) and one invoice (US-FIN-08). Split
 * from `InvoicesService` because issuing and voiding change the legal record
 * while this only reports it — and the two have entirely different guards.
 *
 * Every read is aged against the same Bangkok date, taken once per request, so
 * the tab counts and the rows beneath them describe the same instant.
 */
@Injectable()
export class InvoicesLedgerService {
  constructor(
    private readonly repo: InvoicesRepository,
    private readonly clock: Clock,
  ) {}

  async list(
    auth: AuthContext,
    query: ListInvoicesQuery,
  ): Promise<{
    page: Paginated<InvoiceEntryDto>;
    counts: InvoiceCountsDto;
  }> {
    const today = bangkokToday(this.clock.now());
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(
      MAX_LIMIT,
      Math.max(1, query.limit ?? DEFAULT_LIMIT),
    );
    const filters: InvoiceFilters = { ...query, page, limit };
    // Deliberately WITHOUT the status filter: the tabs count the whole ledger,
    // so page 2 of "Overdue" still shows how many Paid there are.
    const countFilters: Omit<InvoiceFilters, 'status'> = {
      page,
      limit,
      eventId: query.eventId,
      search: query.search,
    };
    const [result, counts] = await Promise.all([
      this.repo.page(auth.organizationId, filters, today),
      this.repo.countByStatus(auth.organizationId, countFilters, today),
    ]);
    return {
      page: Paginated.of(
        result.items.map((row) => toInvoiceEntry(row, today)),
        result.total,
        page,
        limit,
      ),
      counts,
    };
  }

  async detail(
    auth: AuthContext,
    invoiceId: number,
  ): Promise<InvoiceDetailDto> {
    const today = bangkokToday(this.clock.now());
    const row = await this.repo.findById(auth.organizationId, invoiceId);
    if (!row) throw DomainException.notFound('Invoice not found.');
    return toInvoiceDetail(row, today);
  }

  /** The printable A4 tax invoice (US-FIN-08). */
  async documentSvg(auth: AuthContext, invoiceId: number): Promise<string> {
    const row = await this.repo.findDocument(auth.organizationId, invoiceId);
    if (!row) throw DomainException.notFound('Invoice not found.');
    return renderInvoiceSvg(row);
  }
}
