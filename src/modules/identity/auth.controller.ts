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
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { LoginResponseDto, RefreshResponseDto } from './dto/token-response.dto';
import { MeResponseDto } from './dto/user-response.dto';

const BEARER = 'Bearer';

@ApiTags('auth')
@Controller()
export class AuthController {
  constructor(private readonly auth: AuthService) {}

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
