import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { ApiErrorDto } from '../../common/errors/error-envelope';
import { ApiData } from '../../common/http/api-data.decorator';
import { LoginResponseDto } from '../auth/dto/token-response.dto';
import { AuthBookingSignupService } from './auth-booking-signup.service';
import { BookingClaimService } from './booking-claim.service';
import { BookingAccountDto } from './dto/booking-account.dto';
import { BookingClaimPreviewDto } from './dto/booking-claim-preview.dto';
import { BookingClaimTokenDto } from './dto/booking-claim-token.dto';
import { BookingLinkSentDto } from './dto/booking-link-sent.dto';
import { ClaimBookingAccountDto } from './dto/claim-booking-account.dto';
import {
  BEARER,
  DEAD_LINK_RESPONSE,
  UNKNOWN_DEVICE,
} from '../../common/constants/auth-booking-signup.constants';

/**
 * Create my account from my confirmation (US-DISC-15). Every route is
 * `@Public`: the buyer has no account yet.
 *
 * Two authorities, never interchangeable. The order's uuid — what the
 * confirmation screen holds — is enough to ask for a link to be emailed to the
 * booking's address, and nothing more; `ParseUUIDPipe` refuses the printed
 * reference rather than searching for it. The emailed link's token — what
 * only that inbox holds — is the only thing that creates the account, and it
 * travels in the request body, never in a URL.
 */
@ApiTags('auth')
@Controller('auth/register/from-booking')
export class AuthBookingSignupController {
  constructor(
    private readonly bookings: AuthBookingSignupService,
    private readonly claims: BookingClaimService,
  ) {}

  @Public()
  @Get(':orderId')
  @ResponseMessage('Booking account checked.')
  @ApiData(BookingAccountDto)
  @ApiNotFoundResponse({ description: 'No such order', type: ApiErrorDto })
  @ApiConflictResponse({
    description:
      'The booking is not confirmed, so it has no tickets to keep and is not told whether its email has an account',
    type: ApiErrorDto,
  })
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
    description:
      'The booking is not confirmed, so it has no tickets to keep — or an attendee account already uses its email',
    type: ApiErrorDto,
  })
  @ApiTooManyRequestsResponse({
    description:
      'A link was sent moments ago, or the address has had its links for the day',
    type: ApiErrorDto,
  })
  requestLink(
    @Param('orderId', ParseUUIDPipe) orderId: string,
  ): Promise<BookingLinkSentDto> {
    return this.bookings.requestLink(orderId);
  }

  @Public()
  @Post('claim/inspect')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Claim link checked.')
  @ApiData(BookingClaimPreviewDto)
  @ApiBadRequestResponse(DEAD_LINK_RESPONSE)
  inspect(@Body() dto: BookingClaimTokenDto): Promise<BookingClaimPreviewDto> {
    return this.claims.inspect(dto.token);
  }

  @Public()
  @Post('claim')
  @ResponseMessage('Account created. You are signed in.')
  @ApiData(LoginResponseDto, HttpStatus.CREATED)
  @ApiBadRequestResponse(DEAD_LINK_RESPONSE)
  @ApiConflictResponse({
    description:
      'An attendee account already uses this email — including because this link was already used',
    type: ApiErrorDto,
  })
  async claim(
    @Body() dto: ClaimBookingAccountDto,
    @Req() req: Request,
  ): Promise<LoginResponseDto> {
    const result = await this.claims.claim({
      token: dto.token,
      password: dto.password,
      device: req.headers['user-agent'] ?? UNKNOWN_DEVICE,
      ip: req.ip ?? null,
    });
    return {
      // A brand-new account has no second factor to ask for.
      twoFactorRequired: false,
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      tokenType: BEARER,
      expiresIn: result.expiresIn,
      user: result.user,
    };
  }
}
