import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentAuth } from '../../common/decorators/current-auth.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { ApiData } from '../../common/http/api-data.decorator';
import type { AuthContext } from '../auth/auth.types';
import {
  AuthTwoFactorService,
  type TwoFactorStatus,
} from './auth-two-factor.service';
import {
  RecoveryCodesDto,
  TwoFactorCodeDto,
  TwoFactorStartDto,
} from './dto/two-factor.dto';

/**
 * Settings → Two-factor (US-SET-03 / US-ACC-07). Always the caller's own
 * enrolment — the user id comes from the token.
 */
@ApiTags('two-factor')
@ApiBearerAuth()
@Controller('me/two-factor')
export class AuthTwoFactorController {
  constructor(private readonly twoFactor: AuthTwoFactorService) {}

  @Get()
  @ResponseMessage('Two-factor status retrieved.')
  status(@CurrentAuth() auth: AuthContext): Promise<TwoFactorStatus> {
    return this.twoFactor.status(auth);
  }

  @Post('start')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Scan the code with your authenticator app.')
  @ApiData(TwoFactorStartDto)
  start(@CurrentAuth() auth: AuthContext): Promise<TwoFactorStartDto> {
    return this.twoFactor.start(auth);
  }

  @Post('confirm')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Two-factor is on. Save your recovery codes.')
  @ApiData(RecoveryCodesDto)
  async confirm(
    @CurrentAuth() auth: AuthContext,
    @Body() dto: TwoFactorCodeDto,
  ): Promise<RecoveryCodesDto> {
    return { recoveryCodes: await this.twoFactor.confirm(auth, dto.code) };
  }

  @Post('recovery-codes')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('New recovery codes issued — the old ones no longer work.')
  @ApiData(RecoveryCodesDto)
  async regenerate(
    @CurrentAuth() auth: AuthContext,
    @Body() dto: TwoFactorCodeDto,
  ): Promise<RecoveryCodesDto> {
    return {
      recoveryCodes: await this.twoFactor.regenerateRecoveryCodes(
        auth,
        dto.code,
      ),
    };
  }

  @Post('disable')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Two-factor turned off.')
  disable(
    @CurrentAuth() auth: AuthContext,
    @Body() dto: TwoFactorCodeDto,
  ): Promise<void> {
    return this.twoFactor.disable(auth, dto.code);
  }
}
