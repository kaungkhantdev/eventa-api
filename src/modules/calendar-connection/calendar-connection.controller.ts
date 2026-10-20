import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentAuth } from '../../common/decorators/current-auth.decorator';
import {
  Permission,
  RequirePermissions,
} from '../../common/decorators/require-permissions.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { ApiErrorDto } from '../../common/errors/error-envelope';
import { AdminGuard } from '../../common/guards/admin.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { ApiData } from '../../common/http/api-data.decorator';
import type { AuthContext } from '../auth/auth.types';
import { CalendarConnectFlowService } from './calendar-connect-flow.service';
import { CalendarConnectionService } from './calendar-connection.service';
import {
  CalendarConnectionDto,
  CalendarConnectStartDto,
} from './dto/calendar-connection.dto';

/**
 * Settings → Integrations: the workspace Google Calendar (US-MTG-08).
 *
 * Reading the status needs no permission key — the Meetings header shows it
 * to every console member — but it does need the organizer console:
 * `AdminGuard` keeps attendee tokens out, which `PermissionsGuard` alone
 * would not (it passes any route without a key). Connecting and
 * disconnecting need Manage integrations, Admin-only in the default roles,
 * and are refused server-side (NFR-SEC-02); hiding the buttons is cosmetic.
 */
@ApiTags('calendar-connection')
@ApiBearerAuth()
@ApiForbiddenResponse({
  description: 'Not the organizer console, or lacks Manage integrations',
  type: ApiErrorDto,
})
@Controller('calendar-connection')
@UseGuards(AdminGuard, PermissionsGuard)
export class CalendarConnectionController {
  constructor(
    private readonly connection: CalendarConnectionService,
    private readonly flow: CalendarConnectFlowService,
  ) {}

  @Get()
  @ResponseMessage('Calendar connection retrieved.')
  @ApiData(CalendarConnectionDto)
  get(@CurrentAuth() auth: AuthContext): Promise<CalendarConnectionDto> {
    return this.connection.status(auth);
  }

  /**
   * Start a connect (or a reconnect, or a switch of account): returns
   * Google's consent URL for the browser to open. Allowed in every status.
   */
  @Post('connect')
  @RequirePermissions(Permission.setIntegrations)
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Continue in Google to connect the calendar.')
  @ApiData(CalendarConnectStartDto)
  @ApiConflictResponse({
    description: 'This server has no Google client configured',
    type: ApiErrorDto,
  })
  connect(@CurrentAuth() auth: AuthContext): Promise<CalendarConnectStartDto> {
    return this.flow.start(auth);
  }

  /** Stop syncing and withdraw the grant. Idempotent. */
  @Post('disconnect')
  @RequirePermissions(Permission.setIntegrations)
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Google Calendar disconnected.')
  @ApiData(CalendarConnectionDto)
  disconnect(@CurrentAuth() auth: AuthContext): Promise<CalendarConnectionDto> {
    return this.connection.disconnect(auth);
  }
}
