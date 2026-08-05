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
import { LoginResponseDto } from '../auth/dto/token-response.dto';
import { TwoFactorSignInDto } from './dto/two-factor-signin.dto';
import { TwoFactorSignInService } from './two-factor-signin.service';

const BEARER = 'Bearer';

/**
 * Step two of a two-factor sign-in (US-ACC-05 / US-DISC-12). `@Public` because
 * the caller has no session yet — the challenge token from `POST /auth/login`
 * is the credential, and it buys nothing but the right to present a code.
 */
@ApiTags('auth')
@Controller('auth/two-factor')
export class TwoFactorSignInController {
  constructor(private readonly signIn: TwoFactorSignInService) {}

  @Public()
  @Post()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Signed in.')
  @ApiData(LoginResponseDto)
  @ApiUnauthorizedResponse({
    description: 'Expired challenge or wrong code',
    type: ApiErrorDto,
  })
  async complete(
    @Body() dto: TwoFactorSignInDto,
    @Req() req: Request,
  ): Promise<LoginResponseDto> {
    const result = await this.signIn.complete({
      challengeToken: dto.challengeToken,
      code: dto.code,
      device: req.headers['user-agent'] ?? 'Unknown device',
      ip: req.ip ?? null,
    });
    return {
      twoFactorRequired: false,
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      tokenType: BEARER,
      expiresIn: result.expiresIn,
      user: result.user,
    };
  }
}
