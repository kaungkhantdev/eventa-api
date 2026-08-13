import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentAuth } from '../../common/decorators/current-auth.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { AdminGuard } from '../../common/guards/admin.guard';
import { ApiData, ApiPage } from '../../common/http/api-data.decorator';
import type { Paginated } from '../../common/http/paginated';
import type { AuthContext } from '../auth/auth.types';
import {
  CancelMeetingDto,
  ListMeetingsDto,
  MeetingCountsDto,
  MeetingEntryDto,
  RescheduleMeetingDto,
  ScheduleMeetingDto,
} from './dto/meetings.dto';
import { toMeetingEntry } from './meetings.mapper';
import { MeetingsQueryService } from './meetings-query.service';
import { MeetingsService } from './meetings.service';
import { Clock } from '../../common/time/clock';

/**
 * The organizer's meetings (E12).
 *
 * `AdminGuard` only, with no permission key: meetings are the organizer's own
 * coordination diary rather than tenant business records, and the backlog
 * defines no `mtg*` permission. Every route is workspace-scoped through
 * `@CurrentAuth`, so one workspace never sees another's diary.
 */
@ApiTags('meetings')
@ApiBearerAuth()
@Controller('meetings')
@UseGuards(AdminGuard)
export class MeetingsController {
  constructor(
    private readonly meetings: MeetingsService,
    private readonly query: MeetingsQueryService,
    private readonly clock: Clock,
  ) {}

  @Get()
  @ResponseMessage('Meetings retrieved.')
  @ApiPage(MeetingEntryDto, 200, { counts: MeetingCountsDto })
  async list(
    @CurrentAuth() auth: AuthContext,
    @Query() query: ListMeetingsDto,
  ): Promise<Paginated<MeetingEntryDto>> {
    const { page, counts, emptyMessage } = await this.query.list(auth, {
      ...query,
    });
    return page.withMeta({ counts, emptyMessage });
  }

  @Post()
  @ResponseMessage('Meeting scheduled.')
  @ApiData(MeetingEntryDto, 201)
  async schedule(
    @CurrentAuth() auth: AuthContext,
    @Body() body: ScheduleMeetingDto,
  ): Promise<MeetingEntryDto> {
    const { meeting } = await this.meetings.schedule(auth, { ...body });
    return this.toEntry(meeting);
  }

  @Patch(':id')
  @ResponseMessage('Meeting updated.')
  @ApiData(MeetingEntryDto)
  async reschedule(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: RescheduleMeetingDto,
  ): Promise<MeetingEntryDto> {
    return this.toEntry(await this.meetings.reschedule(auth, id, { ...body }));
  }

  @Post(':id/cancel')
  @ResponseMessage('Meeting cancelled.')
  @ApiData(MeetingEntryDto)
  async cancel(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: CancelMeetingDto,
  ): Promise<MeetingEntryDto> {
    return this.toEntry(
      await this.meetings.cancel(auth, id, body.reason ?? null),
    );
  }

  /** Ask the calendar again after an outage left the invite unsent. */
  @Post(':id/sync')
  @ResponseMessage('Calendar sync requested.')
  @ApiData(MeetingEntryDto)
  async retrySync(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<MeetingEntryDto> {
    return this.toEntry(await this.meetings.retrySync(auth, id));
  }

  /**
   * The event name is left null on a write response: the row the organizer just
   * saved is echoed back, and the list is where names are resolved in one query
   * rather than one per meeting.
   */
  private toEntry(meeting: Parameters<typeof toMeetingEntry>[0]) {
    return toMeetingEntry(meeting, null, this.clock.now());
  }
}
