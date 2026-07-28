import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiNoContentResponse,
  ApiOkResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { CookieOptions, Request, Response } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import type { Env } from '../../config/env.validation';
import { AuthService } from './auth.service';
import { type AuthContext, SESSION_COOKIE, SESSION_TTL_MS } from './auth.types';
import { CurrentAuth } from './decorators/current-auth.decorator';
import { LoginDto } from './dto/login.dto';
import { MeResponseDto } from './dto/user-response.dto';

@ApiTags('auth')
@Controller()
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  @Public()
  @Post('auth/login')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: MeResponseDto })
  @ApiUnauthorizedResponse({ description: 'Invalid credentials' })
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<MeResponseDto> {
    const device = req.headers['user-agent'] ?? 'Unknown device';
    const { sessionId, user } = await this.auth.login({
      email: dto.email,
      password: dto.password,
      orgSlug: dto.orgSlug,
      persona: dto.persona,
      device,
      ip: req.ip ?? null,
    });
    res.cookie(SESSION_COOKIE, sessionId, this.cookieOptions());
    return user;
  }

  @Get('auth/me')
  @ApiOkResponse({ type: MeResponseDto })
  me(@CurrentAuth() auth: AuthContext): Promise<MeResponseDto> {
    return this.auth.me(auth);
  }

  @Delete('session')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse({ description: 'Signed out' })
  async logout(
    @CurrentAuth() auth: AuthContext,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.auth.logout(auth);
    res.clearCookie(SESSION_COOKIE, { path: '/' });
  }

  private cookieOptions(): CookieOptions {
    const isProd =
      this.config.get('NODE_ENV', { infer: true }) === 'production';
    return {
      httpOnly: true,
      secure: isProd,
      sameSite: 'lax',
      maxAge: SESSION_TTL_MS,
      path: '/',
    };
  }
}
