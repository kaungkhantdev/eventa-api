import {
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
import { CurrentAuth } from '../../common/decorators/current-auth.decorator';
import {
  Permission,
  RequirePermissions,
} from '../../common/decorators/require-permissions.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { ApiErrorDto } from '../../common/errors/error-envelope';
import { AdminGuard } from '../../common/guards/admin.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { ApiData, ApiPage } from '../../common/http/api-data.decorator';
import type { Paginated } from '../../common/http/paginated';
import type { AuthContext } from '../auth/auth.types';
import {
  BalancesDto,
  ListPayoutsDto,
  PayoutDetailDto,
  PayoutEntryDto,
  PayoutSettingsLinkDto,
} from './dto/payouts.dto';
import { toBalances } from './payouts.mapper';
import { PayoutsService } from './payouts.service';

/**
 * Payouts (US-FIN-03/04/05). Reading balances and history is `finView` — an
 * Organizer needs to know what they have earned. Moving money (retry) and
 * reaching the provider's bank settings are `finManage`, the Admin-only tier of
 * US-FIN-14.
 */
@ApiTags('payouts')
@ApiBearerAuth()
@Controller('payouts')
@UseGuards(AdminGuard, PermissionsGuard)
export class PayoutsController {
  constructor(private readonly payouts: PayoutsService) {}

  @Get('balances')
  @RequirePermissions(Permission.finView)
  @ResponseMessage('Balances retrieved.')
  @ApiData(BalancesDto)
  async balances(@CurrentAuth() auth: AuthContext): Promise<BalancesDto> {
    return toBalances(await this.payouts.balances(auth));
  }

  @Get()
  @RequirePermissions(Permission.finView)
  @ResponseMessage('Payouts retrieved.')
  @ApiPage(PayoutEntryDto)
  list(
    @CurrentAuth() auth: AuthContext,
    @Query() query: ListPayoutsDto,
  ): Promise<Paginated<PayoutEntryDto>> {
    return this.payouts.list(auth, { ...query });
  }

  /**
   * Where to manage bank details, the payout schedule and tax forms — a
   * one-time link to the provider, because none of that lives here (US-FIN-05).
   */
  @Post('settings-link')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.finManage)
  @ResponseMessage('Payout settings link created.')
  @ApiData(PayoutSettingsLinkDto)
  settingsLink(
    @CurrentAuth() auth: AuthContext,
  ): Promise<PayoutSettingsLinkDto> {
    return this.payouts.settingsLink(auth);
  }

  @Get(':reference')
  @RequirePermissions(Permission.finView)
  @ResponseMessage('Payout retrieved.')
  @ApiData(PayoutDetailDto)
  detail(
    @CurrentAuth() auth: AuthContext,
    @Param('reference') reference: string,
  ): Promise<PayoutDetailDto> {
    return this.payouts.detail(auth, reference);
  }

  @Post(':reference/retry')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.finManage)
  @ResponseMessage('Payout resubmitted.')
  @ApiData(PayoutDetailDto)
  @ApiConflictResponse({
    description: 'Not a failed payout, or no account connected',
    type: ApiErrorDto,
  })
  retry(
    @CurrentAuth() auth: AuthContext,
    @Param('reference') reference: string,
  ): Promise<PayoutDetailDto> {
    return this.payouts.retry(auth, reference);
  }
}
