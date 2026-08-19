import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentAuth } from '../../common/decorators/current-auth.decorator';
import {
  Permission,
  RequirePermissions,
} from '../../common/decorators/require-permissions.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { AdminGuard } from '../../common/guards/admin.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { ApiPage } from '../../common/http/api-data.decorator';
import type { Paginated } from '../../common/http/paginated';
import type { AuthContext } from '../auth/auth.types';
import { AttendeeDirectoryService } from './attendee-directory.service';
import {
  AttendeeEntryDto,
  ListAttendeesDto,
  SegmentCountsDto,
} from './dto/directory.dto';

/** The attendee directory (US-REG-05). `regView` — reading, not deciding. */
@ApiTags('attendees')
@ApiBearerAuth()
@Controller('attendees')
@UseGuards(AdminGuard, PermissionsGuard)
export class AttendeeDirectoryController {
  constructor(private readonly directory: AttendeeDirectoryService) {}

  @Get()
  @RequirePermissions(Permission.regView)
  @ResponseMessage('Attendees retrieved.')
  @ApiPage(AttendeeEntryDto, 200, { counts: SegmentCountsDto })
  async list(
    @CurrentAuth() auth: AuthContext,
    @Query() query: ListAttendeesDto,
  ): Promise<Paginated<AttendeeEntryDto>> {
    const { page, counts } = await this.directory.list(auth, { ...query });
    return page.withMeta({ counts });
  }
}
