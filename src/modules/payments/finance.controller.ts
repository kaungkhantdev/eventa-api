import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiConflictResponse, ApiTags } from '@nestjs/swagger';
import { ApiPage } from '../../common/http/api-data.decorator';
import type { Paginated } from '../../common/http/paginated';
import { CurrentAuth } from '../../common/decorators/current-auth.decorator';
import {
  Permission,
  RequirePermissions,
} from '../../common/decorators/require-permissions.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { ApiErrorDto } from '../../common/errors/error-envelope';
import { AdminGuard } from '../../common/guards/admin.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { ApiData } from '../../common/http/api-data.decorator';
import type { AuthContext } from '../auth/auth.types';
import { RefundPaymentDto, RefundResponseDto } from './dto/refund-payment.dto';
import {
  LedgerCountsDto,
  LedgerEntryDto,
  ListPaymentsDto,
} from './dto/list-payments.dto';
import { PaymentsLedgerService } from './payments-ledger.service';
import { RefundsService } from './refunds.service';

/**
 * The finance surface: the payments ledger (US-FIN-01) and issuing a refund
 * (US-FIN-02). Refunding is guarded twice on purpose: `AdminGuard` because
 * the story restricts refunds to Admins rather than Organizers, and
 * `finRefund` because refunding is a distinct capability from viewing finance.
 */
@ApiTags('finance')
@Controller('payments')
@UseGuards(AdminGuard, PermissionsGuard)
export class FinanceController {
  constructor(
    private readonly refunds: RefundsService,
    private readonly ledger: PaymentsLedgerService,
  ) {}

  /**
   * Every charge, refund and failed attempt (US-FIN-01). `finView`, not
   * `finRefund` — reading the ledger and moving money are separate capabilities.
   */
  @Get()
  @ApiBearerAuth()
  @RequirePermissions(Permission.finView)
  @ResponseMessage('Payments retrieved.')
  @ApiPage(LedgerEntryDto, HttpStatus.OK, { counts: LedgerCountsDto })
  async list(
    @CurrentAuth() auth: AuthContext,
    @Query() query: ListPaymentsDto,
  ): Promise<Paginated<LedgerEntryDto>> {
    const { page, counts } = await this.ledger.list(auth, { ...query });
    // `meta`, not a property on the page: the envelope interceptor rebuilds the
    // response from `items` + `meta`, so anything else assigned is dropped.
    return page.withMeta({ counts });
  }

  @Post(':id/refund')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @RequirePermissions(Permission.finRefund)
  @ResponseMessage('Refund issued.')
  @ApiData(RefundResponseDto)
  @ApiConflictResponse({
    description: 'Not a completed payment, or already refunded',
    type: ApiErrorDto,
  })
  refund(
    @CurrentAuth() auth: AuthContext,
    @Param('id') paymentId: string,
    @Body() dto: RefundPaymentDto,
  ): Promise<RefundResponseDto> {
    return this.refunds.refund(auth, {
      paymentId,
      idempotencyKey: dto.idempotencyKey,
    });
  }
}
