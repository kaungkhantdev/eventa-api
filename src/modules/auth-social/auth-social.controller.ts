import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
} from '@nestjs/common';
import { ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import type { Request } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { ApiErrorDto } from '../../common/errors/error-envelope';
import { ApiData } from '../../common/http/api-data.decorator';
import type { Persona } from '../auth/auth.types';
import { LoginResponseDto } from '../auth/dto/token-response.dto';
import { AuthSocialService } from './auth-social.service';
import { SocialSignInDto } from './dto/social-sign-in.dto';

const BEARER = 'Bearer';

/**
 * Social sign-in (US-ACC-06). There are two endpoints on purpose: the AUDIENCE
 * comes from which one you call, never from the token, so an organizer flow can
 * only ever create or link an organizer account and the attendee portal only an
 * attendee (US-ACC-11).
 */
@ApiTags('auth')
@Controller('auth/social')
export class AuthSocialController {
  constructor(private readonly social: AuthSocialService) {}

  @Public()
  @Post('organizer')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Signed in successfully.')
  @ApiData(LoginResponseDto)
  @ApiUnauthorizedResponse({
    description: 'Cancelled or unverifiable sign-in',
    type: ApiErrorDto,
  })
  organizer(
    @Body() dto: SocialSignInDto,
    @Req() req: Request,
  ): Promise<LoginResponseDto> {
    return this.signIn(dto, req, 'admin');
  }

  @Public()
  @Post('attendee')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Signed in successfully.')
  @ApiData(LoginResponseDto)
  @ApiUnauthorizedResponse({
    description: 'Cancelled or unverifiable sign-in',
    type: ApiErrorDto,
  })
  attendee(
    @Body() dto: SocialSignInDto,
    @Req() req: Request,
  ): Promise<LoginResponseDto> {
    return this.signIn(dto, req, 'attendee');
  }

  private async signIn(
    dto: SocialSignInDto,
    req: Request,
    audience: Persona,
  ): Promise<LoginResponseDto> {
    const result = await this.social.signIn({
      provider: dto.provider,
      idToken: dto.idToken ?? '',
      error: dto.error,
      orgSlug: dto.orgSlug,
      rememberMe: dto.rememberMe,
      audience,
      device: req.headers['user-agent'] ?? 'Unknown device',
      ip: req.ip ?? null,
    });
    return {
      // Social sign-in verified the provider's own second factor already.
      twoFactorRequired: false,
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      tokenType: BEARER,
      expiresIn: result.expiresIn,
      user: result.user,
    };
  }
}
