import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentAuth } from '../../common/decorators/current-auth.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { ApiData } from '../../common/http/api-data.decorator';
import type { AuthContext } from '../auth/auth.types';
import { ChangeEmailDto } from './dto/change-email.dto';
import { ChangePhoneDto } from './dto/change-phone.dto';
import { ConfirmEmailDto } from './dto/confirm-email.dto';
import { ConfirmPhoneDto } from './dto/confirm-phone.dto';
import { ProfileResponseDto } from './dto/profile-response.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { PhoneVerificationService } from './phone-verification.service';
import { ProfileService } from './profile.service';

/**
 * Settings → My profile (US-SET-01). Every route acts on the CALLER's own record
 * — the id comes from the token, never the path, so a member can't edit anyone
 * else here (that's Team administration).
 */
@ApiTags('profile')
@Controller('me')
export class ProfileController {
  constructor(
    private readonly profile: ProfileService,
    private readonly phones: PhoneVerificationService,
  ) {}

  @Get('profile')
  @ApiBearerAuth()
  @ResponseMessage('Profile retrieved.')
  @ApiData(ProfileResponseDto)
  get(@CurrentAuth() auth: AuthContext): Promise<ProfileResponseDto> {
    return this.profile.get(auth);
  }

  @Patch('profile')
  @ApiBearerAuth()
  @ResponseMessage('Profile updated.')
  @ApiData(ProfileResponseDto)
  update(
    @CurrentAuth() auth: AuthContext,
    @Body() dto: UpdateProfileDto,
  ): Promise<ProfileResponseDto> {
    return this.profile.update(auth, dto);
  }

  @Post('profile/email')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.ACCEPTED)
  @ResponseMessage('Check your new inbox to confirm the change.')
  @ApiData(ProfileResponseDto, HttpStatus.ACCEPTED)
  changeEmail(
    @CurrentAuth() auth: AuthContext,
    @Body() dto: ChangeEmailDto,
  ): Promise<ProfileResponseDto> {
    return this.profile.requestEmailChange(auth, dto.email);
  }

  @Public()
  @Post('profile/email/confirm')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Email confirmed.')
  @ApiData(ProfileResponseDto)
  confirmEmail(@Body() dto: ConfirmEmailDto): Promise<ProfileResponseDto> {
    return this.profile.confirmEmailChange(dto.token);
  }

  /**
   * Ask to use a new number (US-DISC-11 AC3). Posting the same number again is
   * the resend — see `PhoneVerificationService.request`.
   */
  @Post('profile/phone')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.ACCEPTED)
  @ResponseMessage('We texted a code to that number. Enter it to confirm.')
  @ApiData(ProfileResponseDto, HttpStatus.ACCEPTED)
  changePhone(
    @CurrentAuth() auth: AuthContext,
    @Body() dto: ChangePhoneDto,
  ): Promise<ProfileResponseDto> {
    return this.phones.request(auth, dto.phone);
  }

  /**
   * NOT `@Public()`, unlike its email twin. The email link is opened in a mail
   * client that carries no session, so the signed token in the URL has to be
   * the whole authorisation. A code is retyped into the settings page the
   * member already has open, so the session is right there — and requiring it
   * means six guessable digits are never an anonymous endpoint's problem.
   */
  @Post('profile/phone/confirm')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Phone number confirmed.')
  @ApiData(ProfileResponseDto)
  confirmPhone(
    @CurrentAuth() auth: AuthContext,
    @Body() dto: ConfirmPhoneDto,
  ): Promise<ProfileResponseDto> {
    return this.phones.confirm(auth, dto.code);
  }

  /** Take the number off the account, along with any unconfirmed change. */
  @Delete('profile/phone')
  @ApiBearerAuth()
  @ResponseMessage('Phone number removed.')
  @ApiData(ProfileResponseDto)
  removePhone(@CurrentAuth() auth: AuthContext): Promise<ProfileResponseDto> {
    return this.phones.remove(auth);
  }
}
