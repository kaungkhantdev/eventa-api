import {
  Body,
  Param,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  type RawBodyRequest,
} from '@nestjs/common';
import { ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { SkipResponseEnvelope } from '../../common/decorators/skip-envelope.decorator';
import { ApiData } from '../../common/http/api-data.decorator';
import { PayOrderDto } from './dto/pay-order.dto';
import { PaymentIntentDto } from './dto/payment-intent.dto';
import { PaymentsService, type WebhookAck } from './payments.service';

/** The header Stripe signs its callbacks with; the fake uses it too. */
const SIGNATURE_HEADER = 'stripe-signature';

/**
 * Paying for an order (US-DISC-05). `pay` is `@Public` like the rest of
 * checkout — a guest pays without an account, and the unguessable order id is
 * the capability. The webhook is `@Public` in the auth sense but far stricter in
 * its own: every callback must carry a valid provider signature over the exact
 * raw bytes, or it is refused outright.
 */
@ApiTags('payments')
@Controller('public/payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Public()
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ResponseMessage('Payment started.')
  @ApiData(PaymentIntentDto, HttpStatus.CREATED)
  pay(@Body() dto: PayOrderDto): Promise<PaymentIntentDto> {
    return this.payments.pay(dto);
  }

  /**
   * The provider's callback — the source of truth for payment state. Raw body
   * on purpose: the signature covers the exact bytes sent, and a re-serialized
   * JSON object would never verify.
   */
  @Public()
  @Post('webhook/:token')
  @HttpCode(HttpStatus.OK)
  @SkipResponseEnvelope()
  @ApiExcludeEndpoint()
  webhook(
    @Param('token') token: string,
    @Req() req: RawBodyRequest<Request>,
    @Headers(SIGNATURE_HEADER) signature: string | undefined,
  ): Promise<WebhookAck> {
    return this.payments.handleWebhook(
      token,
      req.rawBody ?? Buffer.alloc(0),
      signature ?? '',
    );
  }
}
