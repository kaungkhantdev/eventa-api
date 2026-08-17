import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiNoContentResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { ApiData } from '../../common/http/api-data.decorator';
import { CheckoutOrderService } from './checkout-order.service';
import { CheckoutService } from './checkout.service';
import { CheckoutViewService } from './checkout-view.service';
import { CheckoutViewDto } from './dto/checkout-view.dto';
import { ConfirmOrderDto } from './dto/confirm-order.dto';
import { GuestOrderDto } from './dto/guest-order.dto';
import { OrderPlacedDto } from './dto/order-placed.dto';
import { CheckoutHoldDto, OrderSummaryDto } from './dto/order-summary.dto';
import {
  HoldCheckoutDto,
  QuoteCheckoutDto,
  ReleaseCheckoutDto,
} from './dto/quote-checkout.dto';

/**
 * The attendee's checkout (US-DISC-04). Every route is `@Public`: "Registration
 * requires no account", and forcing a sign-up before someone can see a price is
 * the friction this epic exists to remove. Being signed in changes only whose
 * details pre-fill the form, never what may be bought or what it costs.
 *
 * Authorization is by resolution, not by role — an event that is not published
 * and public simply does not resolve, so there is no private event to address.
 */
@ApiTags('checkout')
@Controller('public/checkout')
export class CheckoutController {
  constructor(
    private readonly view: CheckoutViewService,
    private readonly checkout: CheckoutService,
    private readonly orders: CheckoutOrderService,
  ) {}

  @Public()
  @Get(':slug')
  @ResponseMessage('Checkout opened.')
  @ApiData(CheckoutViewDto)
  open(@Param('slug') slug: string): Promise<CheckoutViewDto> {
    return this.view.view(slug);
  }

  /** Reads only — safe to call on every change to the selection. */
  @Public()
  @Post('quote')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Order summary updated.')
  @ApiData(OrderSummaryDto)
  quote(@Body() dto: QuoteCheckoutDto): Promise<OrderSummaryDto> {
    return this.checkout.quote(dto);
  }

  @Public()
  @Post('hold')
  @HttpCode(HttpStatus.CREATED)
  @ResponseMessage('Your tickets are held.')
  @ApiData(CheckoutHoldDto, HttpStatus.CREATED)
  hold(@Body() dto: HoldCheckoutDto): Promise<CheckoutHoldDto> {
    return this.checkout.hold(dto);
  }

  /**
   * Place the registration. Idempotent by the client's key: a double-tapped
   * Confirm returns the order it already created rather than a second one.
   */
  @Public()
  @Post('confirm')
  @HttpCode(HttpStatus.CREATED)
  @ResponseMessage("You're registered!")
  @ApiData(OrderPlacedDto, HttpStatus.CREATED)
  confirm(@Body() dto: ConfirmOrderDto): Promise<OrderPlacedDto> {
    return this.orders.confirm(dto);
  }

  @Public()
  @Delete('hold')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse({ description: 'The inventory is free again' })
  release(@Body() dto: ReleaseCheckoutDto): Promise<void> {
    return this.checkout.release(dto);
  }
}

/**
 * The buyer's own copy of their order (US-DISC-06/07).
 *
 * Its own controller because it is not part of checking out — it is what the
 * confirmation email links to afterwards, and what the "You're registered"
 * screen sends a guest to. `@Public` for the whole point of it: registration
 * never required an account, so viewing what you bought must not either. The
 * order's uuid is the credential; `ParseUUIDPipe` rejects anything that is not
 * one rather than searching for it.
 */
@ApiTags('checkout')
@Controller('public/orders')
export class GuestOrderController {
  constructor(private readonly orders: CheckoutOrderService) {}

  @Public()
  @Get(':orderId')
  @ResponseMessage('Order retrieved.')
  @ApiData(GuestOrderDto)
  view(
    @Param('orderId', ParseUUIDPipe) orderId: string,
  ): Promise<GuestOrderDto> {
    return this.orders.viewGuestOrder(orderId);
  }
}
