import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentAuth } from '../../common/decorators/current-auth.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { ApiList } from '../../common/http/api-data.decorator';
import type { AuthContext } from '../auth/auth.types';
import { AuthSessionsService } from './auth-sessions.service';
import { SessionResponseDto } from './dto/session-response.dto';

/**
 * Settings → Active sessions (US-SET-04, the surface for US-ACC-09). Scoped to the
 * caller: the user id comes from the token, never the path.
 */
@ApiTags('sessions')
@ApiBearerAuth()
@Controller('me/sessions')
export class AuthSessionsController {
  constructor(private readonly sessions: AuthSessionsService) {}

  @Get()
  @ResponseMessage('Sessions retrieved.')
  @ApiList(SessionResponseDto)
  async list(@CurrentAuth() auth: AuthContext): Promise<SessionResponseDto[]> {
    const rows = await this.sessions.list(auth);
    return rows.map((s) => ({
      ...s,
      signedInAt: s.signedInAt.toISOString(),
      expiresAt: s.expiresAt.toISOString(),
    }));
  }

  @Post('revoke-others')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Signed out of all other devices.')
  revokeOthers(@CurrentAuth() auth: AuthContext): Promise<{ revoked: number }> {
    return this.sessions.revokeOthers(auth);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Device signed out.')
  revoke(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
  ): Promise<void> {
    return this.sessions.revoke(auth, id);
  }
}
