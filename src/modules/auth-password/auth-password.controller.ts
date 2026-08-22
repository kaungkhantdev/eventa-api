import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentAuth } from '../../common/decorators/current-auth.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { ApiData } from '../../common/http/api-data.decorator';
import { MessageResponseDto } from '../../common/http/message-response.dto';
import type { AuthContext } from '../auth/auth.types';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { PasswordChangeService } from './auth-password-change.service';
import { PasswordResetService } from './auth-password-reset.service';

/** Forgotten-password reset (US-ACC-04) and change-while-signed-in (US-ACC-05). */
@ApiTags('auth')
@Controller()
export class AuthPasswordController {
  constructor(
    private readonly passwordReset: PasswordResetService,
    private readonly passwordChange: PasswordChangeService,
  ) {}

  @Public()
  @Post('auth/forgot-password')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('A reset link is on its way.')
  @ApiData(MessageResponseDto)
  forgotPassword(@Body() dto: ForgotPasswordDto): Promise<MessageResponseDto> {
    return this.passwordReset.forgot(dto.email, dto.persona);
  }

  @Public()
  @Post('auth/reset-password')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Password reset.')
  @ApiData(MessageResponseDto)
  resetPassword(@Body() dto: ResetPasswordDto): Promise<MessageResponseDto> {
    return this.passwordReset.reset(dto.token, dto.newPassword);
  }

  @Post('auth/change-password')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Password changed.')
  @ApiBearerAuth()
  @ApiData(MessageResponseDto)
  changePassword(
    @CurrentAuth() auth: AuthContext,
    @Body() dto: ChangePasswordDto,
  ): Promise<MessageResponseDto> {
    return this.passwordChange.change(
      auth,
      dto.currentPassword,
      dto.newPassword,
    );
  }
}
