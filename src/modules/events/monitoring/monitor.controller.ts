import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiForbiddenResponse, ApiTags } from '@nestjs/swagger';
import { ApiErrorDto } from '../../../common/errors/error-envelope';
import { ApiData, ApiPage } from '../../../common/http/api-data.decorator';
import { ResponseMessage } from '../../../common/decorators/response-message.decorator';
import { Paginated } from '../../../common/http/paginated';
import type { AuthContext } from '../../identity/auth.types';
import { CurrentAuth } from '../../identity/decorators/current-auth.decorator';
import {
  Permission,
  RequirePermissions,
} from '../../identity/decorators/require-permissions.decorator';
import { PermissionsGuard } from '../../identity/guards/permissions.guard';
import { AdminGuard } from '../guards/admin.guard';
import { AttendeeBroadcastService } from './attendee-broadcast.service';
import { AttendeeRowDto } from './dto/attendee-row.dto';
import { AttendeesQueryDto } from './dto/attendees.query.dto';
import { BroadcastResultDto } from './dto/broadcast-result.dto';
import { EmailAttendeesDto } from './dto/email-attendees.dto';
import { OverviewResponseDto } from './dto/overview-response.dto';
import { RegistrationsPageDto } from './dto/registrations-page.dto';
import { RegistrationsQueryDto } from './dto/registrations.query.dto';
import { MonitorService } from './monitor.service';

/**
 * Event-workspace Monitor (US-EVT-14). Overview is an organizer surface (evCreate);
 * Registrations/Attendees expose attendee PII, so they require regView. Revenue on
 * the Overview is finance-gated inside the service.
 */
@ApiTags('events')
@ApiBearerAuth()
@ApiForbiddenResponse({
  description: 'Admin persona or required permission missing',
  type: ApiErrorDto,
})
@UseGuards(AdminGuard, PermissionsGuard)
@Controller('events')
export class MonitorController {
  constructor(
    private readonly monitor: MonitorService,
    private readonly broadcast: AttendeeBroadcastService,
  ) {}

  @Get(':id/overview')
  @RequirePermissions(Permission.evCreate)
  @ResponseMessage('Event overview retrieved.')
  @ApiData(OverviewResponseDto)
  overview(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
  ): Promise<OverviewResponseDto> {
    return this.monitor.overview(
      { organizationId: auth.organizationId, userId: auth.userId },
      id,
    );
  }

  @Get(':id/registrations')
  @RequirePermissions(Permission.regView)
  @ResponseMessage('Registrations retrieved.')
  @ApiData(RegistrationsPageDto)
  registrations(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Query() query: RegistrationsQueryDto,
  ): Promise<RegistrationsPageDto> {
    return this.monitor.registrations(
      { organizationId: auth.organizationId, userId: auth.userId },
      id,
      query,
    );
  }

  @Get(':id/attendees')
  @RequirePermissions(Permission.regView)
  @ResponseMessage('Attendees retrieved.')
  @ApiPage(AttendeeRowDto)
  attendees(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Query() query: AttendeesQueryDto,
  ): Promise<Paginated<AttendeeRowDto>> {
    return this.monitor.attendees(
      { organizationId: auth.organizationId, userId: auth.userId },
      id,
      query,
    );
  }

  @Post(':id/attendees/email')
  @RequirePermissions(Permission.regView)
  @ResponseMessage('Broadcast queued.')
  @ApiData(BroadcastResultDto)
  emailAttendees(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Body() body: EmailAttendeesDto,
  ): Promise<BroadcastResultDto> {
    return this.broadcast.emailAll(
      { organizationId: auth.organizationId, userId: auth.userId },
      id,
      body,
    );
  }
}
