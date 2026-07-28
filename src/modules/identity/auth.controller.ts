import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNoContentResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { ApiData } from '../../common/http/api-data.decorator';
import { AuthService } from './auth.service';
import type { AuthContext } from './auth.types';
import { CurrentAuth } from './decorators/current-auth.decorator';
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
  @ApiData(LoginResponseDto)
  @ApiUnauthorizedResponse({ description: 'Invalid credentials' })
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
  @ApiData(RefreshResponseDto)
  @ApiUnauthorizedResponse({ description: 'Invalid or revoked refresh token' })
  async refresh(@Body() dto: RefreshDto): Promise<RefreshResponseDto> {
    const result = await this.auth.refresh(dto.refreshToken);
    return {
      accessToken: result.accessToken,
      tokenType: BEARER,
      expiresIn: result.expiresIn,
    };
  }

  @Get('auth/me')
  @ApiBearerAuth()
  @ApiData(MeResponseDto)
  me(@CurrentAuth() auth: AuthContext): Promise<MeResponseDto> {
    return this.auth.me(auth);
  }

  @Delete('session')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @ApiNoContentResponse({ description: 'Signed out (refresh session revoked)' })
  logout(@CurrentAuth() auth: AuthContext): Promise<void> {
    return this.auth.logout(auth);
  }
}
