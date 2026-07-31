import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { ApiErrorDto } from '../../common/errors/error-envelope';
import { ApiData } from '../../common/http/api-data.decorator';
import { AuthService } from './auth.service';
import type { AuthContext } from './auth.types';
import { CurrentAuth } from './decorators/current-auth.decorator';
import {
  AcceptInviteDto,
  AcceptInviteResponseDto,
} from './dto/accept-invite.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { LoginDto } from './dto/login.dto';
import { MessageResponseDto } from './dto/message-response.dto';
import { RefreshDto } from './dto/refresh.dto';
import { RegisterDto } from './dto/register.dto';
import { RegisterResponseDto } from './dto/register-response.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { LoginResponseDto, RefreshResponseDto } from './dto/token-response.dto';
import { MeResponseDto } from './dto/user-response.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { VerifyEmailResponseDto } from './dto/verify-email-response.dto';
import { PasswordChangeService } from './password-change.service';
import { PasswordResetService } from './password-reset.service';
import { SignupService } from './signup.service';

const BEARER = 'Bearer';

@ApiTags('auth')
@Controller()
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly signup: SignupService,
    private readonly passwordReset: PasswordResetService,
    private readonly passwordChange: PasswordChangeService,
  ) {}

  @Public()
  @Post('auth/forgot-password')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('If an account matches, a reset link is on its way.')
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

  @Public()
  @Post('auth/register')
  @HttpCode(HttpStatus.ACCEPTED)
  @ResponseMessage('Check your inbox to confirm your email.')
  @ApiData(RegisterResponseDto, HttpStatus.ACCEPTED)
  register(@Body() dto: RegisterDto): Promise<RegisterResponseDto> {
    return this.signup.register({
      name: dto.name,
      email: dto.email,
      password: dto.password,
      organizationName: dto.organizationName,
    });
  }

  @Public()
  @Post('auth/verify-email')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Email confirmed.')
  @ApiData(VerifyEmailResponseDto)
  verifyEmail(@Body() dto: VerifyEmailDto): Promise<VerifyEmailResponseDto> {
    return this.signup.verifyEmail(dto.token);
  }

  @Public()
  @Post('auth/login')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Signed in successfully.')
  @ApiData(LoginResponseDto)
  @ApiUnauthorizedResponse({
    description: 'Invalid credentials',
    type: ApiErrorDto,
  })
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
  ): Promise<LoginResponseDto> {
    const device = req.headers['user-agent'] ?? 'Unknown device';
    const result = await this.auth.login({
      email: dto.email,
      password: dto.password,
      orgSlug: dto.orgSlug,
      persona: dto.persona,
      rememberMe: dto.rememberMe,
      device,
      ip: req.ip ?? null,
    });
    return {
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      tokenType: BEARER,
      expiresIn: result.expiresIn,
      user: result.user,
    };
  }

  @Public()
  @Post('auth/refresh')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Access token refreshed.')
  @ApiData(RefreshResponseDto)
  @ApiUnauthorizedResponse({
    description: 'Invalid or revoked refresh token',
    type: ApiErrorDto,
  })
  async refresh(@Body() dto: RefreshDto): Promise<RefreshResponseDto> {
    const result = await this.auth.refresh(dto.refreshToken);
    return {
      accessToken: result.accessToken,
      tokenType: BEARER,
      expiresIn: result.expiresIn,
    };
  }

  @Public()
  @Post('auth/accept-invite')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Invitation accepted.')
  @ApiData(AcceptInviteResponseDto)
  @ApiUnauthorizedResponse({
    description: 'Invalid or expired invite token',
    type: ApiErrorDto,
  })
  acceptInvite(@Body() dto: AcceptInviteDto): Promise<AcceptInviteResponseDto> {
    return this.auth.acceptInvite(dto.token, dto.password);
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

  @Get('auth/me')
  @ResponseMessage('Profile retrieved successfully.')
  @ApiBearerAuth()
  @ApiData(MeResponseDto)
  me(@CurrentAuth() auth: AuthContext): Promise<MeResponseDto> {
    return this.auth.me(auth);
  }

  @Post('auth/logout')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Signed out successfully.')
  @ApiBearerAuth()
  @ApiOkResponse({
    description: 'Signed out (refresh session revoked); data is null',
  })
  logout(@CurrentAuth() auth: AuthContext): Promise<void> {
    return this.auth.logout(auth);
  }
}
