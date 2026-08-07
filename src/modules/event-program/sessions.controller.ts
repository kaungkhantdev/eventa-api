import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiQuery,
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ApiErrorDto } from '../../common/errors/error-envelope';
import { ApiData, ApiList } from '../../common/http/api-data.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import type { AuthContext } from '../auth/auth.types';
import { CurrentAuth } from '../../common/decorators/current-auth.decorator';
import {
  Permission,
  RequireAnyPermission,
  RequirePermissions,
} from '../../common/decorators/require-permissions.decorator';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import type { EventActor } from '../events/events.types';
import { CreateSessionDto } from './dto/create-session.dto';
import { SessionResponseDto } from './dto/session-response.dto';
import { UpdateSessionDto } from './dto/update-session.dto';
import { SessionsService } from './sessions.service';

@ApiTags('sessions')
@ApiBearerAuth()
@ApiForbiddenResponse({
  description: 'Missing the evSpeakers permission',
  type: ApiErrorDto,
})
@UseGuards(PermissionsGuard)
@Controller('events/:eventId/sessions')
export class SessionsController {
  constructor(private readonly sessions: SessionsService) {}

  @Post()
  @RequirePermissions(Permission.evSpeakers)
  @HttpCode(HttpStatus.CREATED)
  @ResponseMessage('Session added.')
  @ApiData(SessionResponseDto, HttpStatus.CREATED)
  create(
    @CurrentAuth() auth: AuthContext,
    @Param('eventId') eventId: string,
    @Body() dto: CreateSessionDto,
  ): Promise<SessionResponseDto> {
    return this.sessions.createSession(actorOf(auth), eventId, dto);
  }

  @Get()
  // Read-only agenda: Staff support attendees on-site (US-PROG-01 note).
  @RequireAnyPermission(Permission.evProgramView, Permission.evSpeakers)
  @ResponseMessage('Sessions retrieved.')
  @ApiList(SessionResponseDto)
  list(
    @CurrentAuth() auth: AuthContext,
    @Param('eventId') eventId: string,
  ): Promise<SessionResponseDto[]> {
    return this.sessions.listSessions(actorOf(auth), eventId);
  }

  @Patch(':id')
  @RequirePermissions(Permission.evSpeakers)
  @ResponseMessage('Session updated.')
  @ApiData(SessionResponseDto)
  update(
    @CurrentAuth() auth: AuthContext,
    @Param('eventId') eventId: string,
    @Param('id') id: string,
    @Body() dto: UpdateSessionDto,
  ): Promise<SessionResponseDto> {
    return this.sessions.updateSession(actorOf(auth), eventId, id, dto);
  }

  /** Requires `?confirm=true` — see `deleteSession` (US-PROG-04). */
  @Delete(':id')
  @RequirePermissions(Permission.evSpeakers)
  @ResponseMessage('Session removed.')
  @ApiQuery({
    name: 'confirm',
    required: true,
    schema: { type: 'boolean' },
    description:
      'Must be true. Removal does not notify attendees who bookmarked the session.',
  })
  remove(
    @CurrentAuth() auth: AuthContext,
    @Param('eventId') eventId: string,
    @Param('id') id: string,
    @Query('confirm') confirm?: string,
  ): Promise<void> {
    return this.sessions.deleteSession(
      actorOf(auth),
      eventId,
      id,
      confirm === 'true',
    );
  }
}

/** The authenticated principal slice the program services need. */
function actorOf(auth: AuthContext): EventActor {
  return { organizationId: auth.organizationId, userId: auth.userId };
}
