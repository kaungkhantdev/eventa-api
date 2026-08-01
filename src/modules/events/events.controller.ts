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
import { ApiBearerAuth, ApiForbiddenResponse, ApiTags } from '@nestjs/swagger';
import { ApiErrorDto } from '../../common/errors/error-envelope';
import {
  ApiData,
  ApiList,
  ApiPage,
} from '../../common/http/api-data.decorator';
import { Paginated } from '../../common/http/paginated';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import type { AuthContext } from '../auth/auth.types';
import { CurrentAuth } from '../../common/decorators/current-auth.decorator';
import {
  Permission,
  RequirePermissions,
} from '../../common/decorators/require-permissions.decorator';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { CalendarQueryDto } from './dto/calendar.query.dto';
import { CalendarResponseDto } from './dto/calendar-response.dto';
import { CancelEventDto } from './dto/cancel-event.dto';
import { CreateEventDto } from './dto/create-event.dto';
import { DeleteEventDto } from './dto/delete-event.dto';
import { EventListItemDto } from './dto/event-list-item.dto';
import { EventResponseDto } from './dto/event-response.dto';
import { EventsSummaryDto } from './dto/events-summary.dto';
import { ListEventsQueryDto } from './dto/list-events.query.dto';
import { UpcomingEventDto } from './dto/upcoming-event.dto';
import { UpcomingQueryDto } from './dto/upcoming.query.dto';
import { PublishEventDto } from './dto/publish-event.dto';
import { UnpublishEventDto } from './dto/unpublish-event.dto';
import { UpdateEventDto } from './dto/update-event.dto';
import { EventsQueryService } from './events-query.service';
import { EventsService } from './events.service';
import { AdminGuard } from '../../common/guards/admin.guard';

@ApiTags('events')
@ApiBearerAuth()
@ApiForbiddenResponse({
  description: 'Admin persona or required permission missing',
  type: ApiErrorDto,
})
@UseGuards(AdminGuard, PermissionsGuard)
@Controller('events')
export class EventsController {
  constructor(
    private readonly events: EventsService,
    private readonly query: EventsQueryService,
  ) {}

  @Post()
  @RequirePermissions(Permission.evCreate)
  @HttpCode(HttpStatus.CREATED)
  @ResponseMessage('Event created.')
  @ApiData(EventResponseDto, HttpStatus.CREATED)
  create(
    @CurrentAuth() auth: AuthContext,
    @Body() dto: CreateEventDto,
  ): Promise<EventResponseDto> {
    return this.events.createDraft(
      { organizationId: auth.organizationId, userId: auth.userId },
      {
        name: dto.name,
        type: dto.type,
        startAt: new Date(dto.startAt),
        description: dto.description,
        categoryId: dto.categoryId,
        organizerName: dto.organizerName,
      },
    );
  }

  @Get()
  @RequirePermissions(Permission.evCreate)
  @ResponseMessage('Events retrieved.')
  @ApiPage(EventListItemDto)
  list(
    @CurrentAuth() auth: AuthContext,
    @Query() query: ListEventsQueryDto,
  ): Promise<Paginated<EventListItemDto>> {
    return this.query.list(
      { organizationId: auth.organizationId, userId: auth.userId },
      query,
    );
  }

  @Get('summary')
  @RequirePermissions(Permission.evCreate)
  @ResponseMessage('Event summary retrieved.')
  @ApiData(EventsSummaryDto)
  summary(@CurrentAuth() auth: AuthContext): Promise<EventsSummaryDto> {
    return this.query.summary({
      organizationId: auth.organizationId,
      userId: auth.userId,
    });
  }

  @Get('calendar')
  @RequirePermissions(Permission.evCreate)
  @ResponseMessage('Calendar retrieved.')
  @ApiData(CalendarResponseDto)
  calendar(
    @CurrentAuth() auth: AuthContext,
    @Query() query: CalendarQueryDto,
  ): Promise<CalendarResponseDto> {
    return this.query.calendar(
      { organizationId: auth.organizationId, userId: auth.userId },
      query.month,
    );
  }

  @Get('upcoming')
  @RequirePermissions(Permission.evCreate)
  @ResponseMessage('Upcoming events retrieved.')
  @ApiList(UpcomingEventDto)
  upcoming(
    @CurrentAuth() auth: AuthContext,
    @Query() query: UpcomingQueryDto,
  ): Promise<UpcomingEventDto[]> {
    return this.query.upcoming(
      { organizationId: auth.organizationId, userId: auth.userId },
      query.limit,
    );
  }

  @Get(':id')
  @RequirePermissions(Permission.evCreate)
  @ResponseMessage('Event retrieved.')
  @ApiData(EventResponseDto)
  get(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
  ): Promise<EventResponseDto> {
    return this.events.getEvent(
      { organizationId: auth.organizationId, userId: auth.userId },
      id,
    );
  }

  @Patch(':id')
  @RequirePermissions(Permission.evCreate)
  @ResponseMessage('Event updated.')
  @ApiData(EventResponseDto)
  update(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Body() dto: UpdateEventDto,
  ): Promise<EventResponseDto> {
    const { startAt, endAt, ...rest } = dto;
    return this.events.updateEvent(
      { organizationId: auth.organizationId, userId: auth.userId },
      id,
      {
        ...rest,
        ...(startAt !== undefined ? { startAt: new Date(startAt) } : {}),
        ...(endAt !== undefined
          ? { endAt: endAt === null ? null : new Date(endAt) }
          : {}),
      },
    );
  }

  @Post(':id/publish')
  @RequirePermissions(Permission.evPublish)
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Event published.')
  @ApiData(EventResponseDto)
  publish(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Body() dto: PublishEventDto,
  ): Promise<EventResponseDto> {
    return this.events.publishEvent(
      { organizationId: auth.organizationId, userId: auth.userId },
      id,
      dto,
    );
  }

  @Post(':id/unpublish')
  @RequirePermissions(Permission.evPublish)
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Event unpublished.')
  @ApiData(EventResponseDto)
  unpublish(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Body() dto: UnpublishEventDto,
  ): Promise<EventResponseDto> {
    return this.events.unpublishEvent(
      { organizationId: auth.organizationId, userId: auth.userId },
      id,
      dto,
    );
  }

  @Post(':id/cancel')
  @RequirePermissions(Permission.evPublish)
  @HttpCode(HttpStatus.OK)
  @ResponseMessage(
    'Event cancelled. Refunds and attendee notices are being processed.',
  )
  @ApiData(EventResponseDto)
  cancel(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Body() dto: CancelEventDto,
  ): Promise<EventResponseDto> {
    return this.events.cancelEvent(
      { organizationId: auth.organizationId, userId: auth.userId },
      id,
      dto,
    );
  }

  @Delete(':id')
  @RequirePermissions(Permission.evPublish)
  @ResponseMessage('Event deleted.')
  remove(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Body() dto: DeleteEventDto,
  ): Promise<void> {
    return this.events.deleteEvent(
      { organizationId: auth.organizationId, userId: auth.userId },
      id,
      dto,
    );
  }
}
