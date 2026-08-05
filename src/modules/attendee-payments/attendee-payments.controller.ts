import {
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentAuth } from '../../common/decorators/current-auth.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { SkipResponseEnvelope } from '../../common/decorators/skip-envelope.decorator';
import { ApiData, ApiPage } from '../../common/http/api-data.decorator';
import type { Paginated } from '../../common/http/paginated';
import type { AuthContext } from '../auth/auth.types';
import { AttendeePaymentsService } from './attendee-payments.service';
import {
  ListTransactionsDto,
  PaymentSummaryDto,
  TransactionDto,
} from './dto/payment-history.dto';

/**
 * The attendee's payment history (US-DISC-10). Signed-in only; every route acts
 * on the caller's own identity, and a receipt that isn't theirs does not resolve.
 */
@ApiTags('attendee-payments')
@ApiBearerAuth()
@Controller('me/payments')
export class AttendeePaymentsController {
  constructor(private readonly payments: AttendeePaymentsService) {}

  @Get('summary')
  @ResponseMessage('Payment summary retrieved.')
  @ApiData(PaymentSummaryDto)
  summary(@CurrentAuth() auth: AuthContext): Promise<PaymentSummaryDto> {
    return this.payments.summary(auth.userId);
  }

  @Get()
  @ResponseMessage('Payment history retrieved.')
  @ApiPage(TransactionDto)
  history(
    @CurrentAuth() auth: AuthContext,
    @Query() query: ListTransactionsDto,
  ): Promise<Paginated<TransactionDto>> {
    return this.payments.history(auth.userId, query);
  }

  /** The full history for expensing — a file, not an envelope. */
  @Get('export.csv')
  @SkipResponseEnvelope()
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="payment-history.csv"')
  exportCsv(@CurrentAuth() auth: AuthContext): Promise<string> {
    return this.payments.exportCsv(auth.userId);
  }

  /** The printable VAT receipt — served as an image, not inside the envelope. */
  @Get(':paymentId/receipt.svg')
  @SkipResponseEnvelope()
  @Header('Content-Type', 'image/svg+xml')
  @Header('Content-Disposition', 'attachment; filename="vat-receipt.svg"')
  receipt(
    @CurrentAuth() auth: AuthContext,
    @Param('paymentId', ParseUUIDPipe) paymentId: string,
  ): Promise<string> {
    return this.payments.receiptSvg(auth.userId, paymentId);
  }
}
