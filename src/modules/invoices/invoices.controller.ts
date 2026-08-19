import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CSV_MIME } from '../../common/csv/csv';
import { CurrentAuth } from '../../common/decorators/current-auth.decorator';
import {
  Permission,
  RequirePermissions,
} from '../../common/decorators/require-permissions.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { SkipResponseEnvelope } from '../../common/decorators/skip-envelope.decorator';
import { ApiErrorDto } from '../../common/errors/error-envelope';
import { AdminGuard } from '../../common/guards/admin.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { ApiData, ApiPage } from '../../common/http/api-data.decorator';
import type { Paginated } from '../../common/http/paginated';
import type { AuthContext } from '../auth/auth.types';
import { IssueInvoiceDto } from './dto/issue-invoice.dto';
import {
  InvoiceCountsDto,
  InvoiceDetailDto,
  InvoiceEntryDto,
  ListInvoicesDto,
} from './dto/list-invoices.dto';
import { VoidInvoiceDto } from './dto/void-invoice.dto';
import { InvoicesLedgerService } from './invoices-ledger.service';
import { InvoicesService } from './invoices.service';

/**
 * The invoice surface (US-FIN-06/07/08/10). The permission split IS the role
 * matrix of US-FIN-14: `finView` covers reading and issuing — an Organizer
 * invoices their own buyers — while voiding needs `finManage`, which only the
 * Admin role is granted. Staff and Attendees hold neither, so Finance is
 * unreachable for them rather than merely hidden.
 */
@ApiTags('invoices')
@ApiBearerAuth()
@Controller('invoices')
@UseGuards(AdminGuard, PermissionsGuard)
export class InvoicesController {
  constructor(
    private readonly invoices: InvoicesService,
    private readonly ledger: InvoicesLedgerService,
  ) {}

  /** The ageing ledger with live tab counts (US-FIN-06). */
  @Get()
  @RequirePermissions(Permission.finView)
  @ResponseMessage('Invoices retrieved.')
  @ApiPage(InvoiceEntryDto, HttpStatus.OK, { counts: InvoiceCountsDto })
  async list(
    @CurrentAuth() auth: AuthContext,
    @Query() query: ListInvoicesDto,
  ): Promise<Paginated<InvoiceEntryDto>> {
    const { page, counts } = await this.ledger.list(auth, { ...query });
    // `meta`, not a property on the page: the envelope interceptor rebuilds the
    // response from `items` + `meta`, so anything else assigned is dropped.
    return page.withMeta({ counts });
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions(Permission.finView)
  @ResponseMessage('Invoice issued.')
  @ApiData(InvoiceDetailDto)
  @ApiConflictResponse({ description: 'Nothing to bill', type: ApiErrorDto })
  issue(
    @CurrentAuth() auth: AuthContext,
    @Body() dto: IssueInvoiceDto,
  ): Promise<unknown> {
    return this.invoices.issue(auth, { orderId: dto.orderId });
  }

  /** The ledger as filtered, as a file — not an envelope (US-FIN-13). */
  @Get('export.csv')
  @RequirePermissions(Permission.finView)
  @SkipResponseEnvelope()
  @Header('Content-Type', CSV_MIME)
  @Header('Content-Disposition', 'attachment; filename="invoices.csv"')
  @ApiConflictResponse({
    description: 'Nothing matches these filters',
    type: ApiErrorDto,
  })
  exportCsv(
    @CurrentAuth() auth: AuthContext,
    @Query() query: ListInvoicesDto,
  ): Promise<string> {
    return this.ledger.exportCsv(auth, { ...query });
  }

  @Get(':id')
  @RequirePermissions(Permission.finView)
  @ResponseMessage('Invoice retrieved.')
  @ApiData(InvoiceDetailDto)
  @ApiNotFoundResponse({ description: 'No such invoice', type: ApiErrorDto })
  detail(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<InvoiceDetailDto> {
    return this.ledger.detail(auth, id);
  }

  /** The printable A4 tax invoice — a document, not an envelope (US-FIN-08). */
  @Get(':id/invoice.svg')
  @RequirePermissions(Permission.finView)
  @SkipResponseEnvelope()
  @Header('Content-Type', 'image/svg+xml')
  @Header('Content-Disposition', 'attachment; filename="tax-invoice.svg"')
  document(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<string> {
    return this.ledger.documentSvg(auth, id);
  }

  /** Admin-only: retire an invoice raised in error, keeping its number. */
  @Post(':id/void')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.finManage)
  @ResponseMessage('Invoice voided.')
  @ApiData(InvoiceDetailDto)
  @ApiConflictResponse({
    description: 'Already paid or already void',
    type: ApiErrorDto,
  })
  voidInvoice(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: VoidInvoiceDto,
  ): Promise<unknown> {
    return this.invoices.voidInvoice(auth, id, dto.reason);
  }
}
