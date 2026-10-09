import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Query,
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
import { ApiData, ApiPage } from '../../common/http/api-data.decorator';
import type { Paginated } from '../../common/http/paginated';
import type { AuthContext } from '../auth/auth.types';
import { AttendeeContactService } from './attendee-contact.service';
import { AttendeeDirectoryService } from './attendee-directory.service';
import {
  AttendeeEntryDto,
  ListAttendeesDto,
  SegmentCountsDto,
} from './dto/directory.dto';
import { UpdateAttendeeContactDto } from './dto/update-attendee-contact.dto';

/** The attendee directory (US-REG-05). `regView` — reading, not deciding. */
@ApiTags('attendees')
@ApiBearerAuth()
@Controller('attendees')
@UseGuards(AdminGuard, PermissionsGuard)
export class AttendeeDirectoryController {
  constructor(
    private readonly directory: AttendeeDirectoryService,
    private readonly contact: AttendeeContactService,
  ) {}

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

  /**
   * Correct a name, email or phone (US-REG-08).
   *
   * `regManage`, not `regView`. Staff hold `regView` by default so the door can
   * look people up, and an edit here changes where somebody's ticket and every
   * future reminder are sent — the same line the registrations queue and the
   * broadcast history draw between seeing attendee data and acting on it.
   * `regExport` is about taking data out and `regCheckin` about the door, so of
   * the four Registrations keys `regManage` is the one that means "decide
   * something about a registration", and it is held by Organizer and Admin
   * exactly — the actors this story names.
   *
   * Answers 409 when the address already belongs to another attendee: the save
   * is refused and the message is the merge prompt, verbatim for the organizer.
   */
  @Patch(':attendeeId')
  @RequirePermissions(Permission.regManage)
  @ResponseMessage('Contact details updated.')
  @ApiData(AttendeeEntryDto)
  @ApiForbiddenResponse({
    type: ApiErrorDto,
    description:
      'Requires regManage — Staff may read the directory, not edit it.',
  })
  @ApiConflictResponse({
    type: ApiErrorDto,
    description:
      'The email already belongs to another attendee (merge the two records), ' +
      'or the record changed while the form was open.',
  })
  updateContact(
    @CurrentAuth() auth: AuthContext,
    @Param('attendeeId', ParseIntPipe) attendeeId: number,
    @Body() dto: UpdateAttendeeContactDto,
  ): Promise<AttendeeEntryDto> {
    return this.contact.updateContact(auth, attendeeId, { ...dto });
  }
}
