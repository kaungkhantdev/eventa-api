import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiConflictResponse, ApiTags } from '@nestjs/swagger';
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
import { RefundsService } from './refunds.service';

/**
 * Issue a refund (US-FIN-02). Guarded twice on purpose: `AdminGuard` because
 * the story restricts refunds to Admins rather than Organizers, and
 * `finRefund` because refunding is a distinct capability from viewing finance.
 */
@ApiTags('finance')
@Controller('payments')
@UseGuards(AdminGuard, PermissionsGuard)
export class RefundsController {
  constructor(private readonly refunds: RefundsService) {}

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
