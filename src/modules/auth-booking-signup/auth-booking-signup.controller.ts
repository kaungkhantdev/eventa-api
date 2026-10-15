import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import {
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
} from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { ApiErrorDto } from '../../common/errors/error-envelope';
import { ApiData } from '../../common/http/api-data.decorator';
import { AuthBookingSignupService } from './auth-booking-signup.service';
import { BookingAccountDto } from './dto/booking-account.dto';
import { BookingLinkSentDto } from './dto/booking-link-sent.dto';

/**
 * The offer on a booking's confirmation screen (US-DISC-15). `@Public` because
 * the buyer has no account yet; the order's uuid is their only authority, as
 * it is on the order page the offer sits on — and that authority is enough to
 * ask for a link to be emailed to the booking's address, never to create or
 * choose anything. `ParseUUIDPipe` refuses the printed reference rather than
 * searching for it.
 */
@ApiTags('auth')
@Controller('auth/register/from-booking')
export class AuthBookingSignupController {
  constructor(private readonly bookings: AuthBookingSignupService) {}

  @Public()
  @Get(':orderId')
  @ResponseMessage('Booking account checked.')
  @ApiData(BookingAccountDto)
  @ApiNotFoundResponse({ description: 'No such order', type: ApiErrorDto })
  account(
    @Param('orderId', ParseUUIDPipe) orderId: string,
  ): Promise<BookingAccountDto> {
    return this.bookings.accountFor(orderId);
  }

  @Public()
  @Post(':orderId/link')
  @HttpCode(HttpStatus.ACCEPTED)
  @ResponseMessage('Link sent to the booking’s email.')
  @ApiData(BookingLinkSentDto, HttpStatus.ACCEPTED)
  @ApiNotFoundResponse({ description: 'No such order', type: ApiErrorDto })
  @ApiConflictResponse({
    description: 'An attendee account already uses the booking’s email',
    type: ApiErrorDto,
  })
  @ApiTooManyRequestsResponse({
    description: 'A link was sent moments ago',
    type: ApiErrorDto,
  })
  requestLink(
    @Param('orderId', ParseUUIDPipe) orderId: string,
  ): Promise<BookingLinkSentDto> {
    return this.bookings.requestLink(orderId);
  }
}
