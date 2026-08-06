import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
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
import { ApiData } from '../../common/http/api-data.decorator';
import type { AuthContext } from '../auth/auth.types';
import {
  FileTaxPeriodDto,
  ListTaxPeriodsDto,
  TaxPeriodDto,
  VatLedgerDto,
} from './dto/tax-periods.dto';
import { toTaxPeriod, toVatHeadlines } from './tax-periods.mapper';
import { TaxPeriodsService } from './tax-periods.service';

/**
 * The monthly VAT ledger (US-FIN-11) and PP30 filing (US-FIN-12). Reading is
 * `finView` — an Organizer prepares the return; recording the filing is
 * `finManage`, the Admin-only tier of US-FIN-14, because a filed period is a
 * frozen legal record.
 *
 * The ledger is always twelve rows, so it is a fixed list rather than a page.
 */
@ApiTags('tax-periods')
@ApiBearerAuth()
@Controller('tax-periods')
@UseGuards(AdminGuard, PermissionsGuard)
export class TaxPeriodsController {
  constructor(private readonly periods: TaxPeriodsService) {}

  @Get()
  @RequirePermissions(Permission.finView)
  @ResponseMessage('VAT periods retrieved.')
  @ApiData(VatLedgerDto)
  async list(
    @CurrentAuth() auth: AuthContext,
    @Query() query: ListTaxPeriodsDto,
  ): Promise<VatLedgerDto> {
    const { rows, headlines } = await this.periods.list(auth, {
      year: query.year,
      status: query.status,
    });
    return {
      periods: rows.map(toTaxPeriod),
      headlines: toVatHeadlines(headlines),
    };
  }

  @Post(':year/:month/file')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.finManage)
  @ResponseMessage('VAT filing recorded.')
  @ApiData(TaxPeriodDto)
  @ApiConflictResponse({
    description: 'Not yet due, or already filed',
    type: ApiErrorDto,
  })
  async file(
    @CurrentAuth() auth: AuthContext,
    @Param('year', ParseIntPipe) year: number,
    @Param('month', ParseIntPipe) month: number,
    @Body() dto: FileTaxPeriodDto,
  ): Promise<TaxPeriodDto> {
    const row = await this.periods.file(auth, {
      year,
      month,
      whtSatang: dto.whtSatang,
    });
    return toTaxPeriod(row);
  }
}
