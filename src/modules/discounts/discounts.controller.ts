import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentAuth } from '../../common/decorators/current-auth.decorator';
import { Public } from '../../common/decorators/public.decorator';
import {
  Permission,
  RequirePermissions,
} from '../../common/decorators/require-permissions.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { ApiErrorDto } from '../../common/errors/error-envelope';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { ApiData, ApiPage } from '../../common/http/api-data.decorator';
import type { Paginated } from '../../common/http/paginated';
import type { AuthContext } from '../auth/auth.types';
import { DiscountRedemptionService } from './discount-redemption.service';
import { DiscountsQueryService } from './discounts-query.service';
import { DiscountsService } from './discounts.service';
import { CreateDiscountDto } from './dto/create-discount.dto';
import { DiscountListItemDto } from './dto/discount-list-item.dto';
import { DiscountResponseDto } from './dto/discount-response.dto';
import { ListDiscountsDto } from './dto/list-discounts.dto';
import { QuoteDiscountDto } from './dto/quote-discount.dto';
import { UpdateDiscountDto } from './dto/update-discount.dto';
import type {
  CreateDiscountInput,
  DeleteDiscountResult,
  DiscountQuoteResult,
  UpdateDiscountInput,
} from './discounts.types';

@ApiTags('discounts')
@Controller('discounts')
export class DiscountsController {
  constructor(
    private readonly discounts: DiscountsService,
    private readonly query: DiscountsQueryService,
    private readonly redemption: DiscountRedemptionService,
  ) {}

  /**
   * Try a code during registration. Public: a guest buys without an account, and
   * the event — not the caller — decides which workspace's codes are reachable.
   */
  @Post('quote')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Discount applied.')
  quote(@Body() dto: QuoteDiscountDto): Promise<DiscountQuoteResult> {
    return this.redemption.quote(dto);
  }

  @Get()
  @UseGuards(PermissionsGuard)
  @ApiBearerAuth()
  @ApiForbiddenResponse({
    description: 'Requires finDiscount',
    type: ApiErrorDto,
  })
  @RequirePermissions(Permission.finDiscount)
  @ResponseMessage('Discount codes retrieved.')
  @ApiPage(DiscountListItemDto)
  list(
    @CurrentAuth() auth: AuthContext,
    @Query() query: ListDiscountsDto,
  ): Promise<Paginated<DiscountListItemDto>> {
    return this.query.list(actorOf(auth), query);
  }

  @Get('suggest')
  @UseGuards(PermissionsGuard)
  @ApiBearerAuth()
  @RequirePermissions(Permission.finDiscount)
  @ResponseMessage('Code suggested.')
  suggest(@CurrentAuth() auth: AuthContext): Promise<{ code: string }> {
    return this.discounts.suggestCode(actorOf(auth));
  }

  @Post()
  @UseGuards(PermissionsGuard)
  @ApiBearerAuth()
  @RequirePermissions(Permission.finDiscount)
  @HttpCode(HttpStatus.CREATED)
  @ResponseMessage('Discount code created.')
  @ApiData(DiscountResponseDto, HttpStatus.CREATED)
  create(
    @CurrentAuth() auth: AuthContext,
    @Body() dto: CreateDiscountDto,
  ): Promise<DiscountResponseDto> {
    return this.discounts.createDiscount(actorOf(auth), toCreateInput(dto));
  }

  @Patch(':id')
  @UseGuards(PermissionsGuard)
  @ApiBearerAuth()
  @RequirePermissions(Permission.finDiscount)
  @ResponseMessage('Discount code updated.')
  @ApiData(DiscountResponseDto)
  update(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Body() dto: UpdateDiscountDto,
  ): Promise<DiscountResponseDto> {
    return this.discounts.updateDiscount(actorOf(auth), id, toUpdateInput(dto));
  }

  @Post(':id/disable')
  @UseGuards(PermissionsGuard)
  @ApiBearerAuth()
  @RequirePermissions(Permission.finDiscount)
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Discount code switched off.')
  @ApiData(DiscountResponseDto)
  disable(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
  ): Promise<DiscountResponseDto> {
    return this.discounts.disableDiscount(actorOf(auth), id);
  }

  @Post(':id/enable')
  @UseGuards(PermissionsGuard)
  @ApiBearerAuth()
  @RequirePermissions(Permission.finDiscount)
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Discount code switched on.')
  @ApiData(DiscountResponseDto)
  enable(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
  ): Promise<DiscountResponseDto> {
    return this.discounts.enableDiscount(actorOf(auth), id);
  }

  @Delete(':id')
  @UseGuards(PermissionsGuard)
  @ApiBearerAuth()
  @RequirePermissions(Permission.finDiscount)
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Discount code removed.')
  @ApiOkResponse({
    description:
      '`removed` when never redeemed, `retired` when past orders keep their discount',
  })
  remove(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
  ): Promise<DeleteDiscountResult> {
    return this.discounts.deleteDiscount(actorOf(auth), id);
  }
}

const actorOf = (auth: AuthContext) => ({
  organizationId: auth.organizationId,
  userId: auth.userId,
});

const date = (v: string | null | undefined): Date | null | undefined => {
  if (v === undefined) return undefined;
  return v === null ? null : new Date(v);
};

function toCreateInput(dto: CreateDiscountDto): CreateDiscountInput {
  const { validFrom, validUntil, ...rest } = dto;
  return { ...rest, validFrom: date(validFrom), validUntil: date(validUntil) };
}

function toUpdateInput(dto: UpdateDiscountDto): UpdateDiscountInput {
  const { validFrom, validUntil, ...rest } = dto;
  return { ...rest, validFrom: date(validFrom), validUntil: date(validUntil) };
}
