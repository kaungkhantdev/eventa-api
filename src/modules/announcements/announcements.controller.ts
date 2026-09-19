import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiForbiddenResponse, ApiTags } from '@nestjs/swagger';
import { CurrentAuth } from '../../common/decorators/current-auth.decorator';
import {
  Permission,
  RequirePermissions,
} from '../../common/decorators/require-permissions.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { ApiErrorDto } from '../../common/errors/error-envelope';
import { AdminGuard } from '../../common/guards/admin.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { ApiPage } from '../../common/http/api-data.decorator';
import type { Paginated } from '../../common/http/paginated';
import type { AuthContext } from '../auth/auth.types';
import { AnnouncementsService } from './announcements.service';
import type { AnnouncementListRow } from './announcements.repository';
import { AnnouncementDto } from './dto/announcement.dto';
import { AnnouncementsQueryDto } from './dto/announcements.query.dto';

/**
 * The broadcasts a workspace has sent (US-MSG-04).
 *
 * Read-only. Sending one is `POST /events/:id/attendees/email` (US-EVT-14) and
 * stays there: a broadcast is something you do to an event's attendees, and
 * splitting the send away from the event it belongs to would leave two places
 * that can start the same thing.
 *
 * Gated on `regView`, the same permission as the send — both are about who you
 * are allowed to write to.
 */
@ApiTags('announcements')
@ApiBearerAuth()
@UseGuards(AdminGuard, PermissionsGuard)
@RequirePermissions(Permission.regView)
@ApiForbiddenResponse({
  type: ApiErrorDto,
  description: 'Seeing who was written to is an attendee-data permission.',
})
@Controller('announcements')
export class AnnouncementsController {
  constructor(private readonly announcements: AnnouncementsService) {}

  @Get()
  @ResponseMessage('Announcements retrieved.')
  @ApiPage(AnnouncementDto)
  list(
    @CurrentAuth() auth: AuthContext,
    @Query() query: AnnouncementsQueryDto,
  ): Promise<Paginated<AnnouncementListRow>> {
    return this.announcements.list(auth, query);
  }
}
