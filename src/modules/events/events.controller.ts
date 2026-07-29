import {
  Body,
  Controller,
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
import { ApiData, ApiPage } from '../../common/http/api-data.decorator';
import { Paginated } from '../../common/http/paginated';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import type { AuthContext } from '../identity/auth.types';
import { CurrentAuth } from '../identity/decorators/current-auth.decorator';
import {
  Permission,
  RequirePermissions,
} from '../identity/decorators/require-permissions.decorator';
import { PermissionsGuard } from '../identity/guards/permissions.guard';
import { CreateEventDto } from './dto/create-event.dto';
import { EventResponseDto } from './dto/event-response.dto';
import { ListEventsQueryDto } from './dto/list-events.query.dto';
import { PublishEventDto } from './dto/publish-event.dto';
import { UnpublishEventDto } from './dto/unpublish-event.dto';
import { UpdateEventDto } from './dto/update-event.dto';
import { EventsService } from './events.service';
import { AdminGuard } from './guards/admin.guard';

@ApiTags('events')
@ApiBearerAuth()
@ApiForbiddenResponse({
  description: 'Admin persona or required permission missing',
  type: ApiErrorDto,
})
@UseGuards(AdminGuard, PermissionsGuard)
@Controller('events')
export class EventsController {
  constructor(private readonly events: EventsService) {}

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
  @ApiPage(EventResponseDto)
  list(
    @CurrentAuth() auth: AuthContext,
    @Query() query: ListEventsQueryDto,
  ): Promise<Paginated<EventResponseDto>> {
    return this.events.list(
      { organizationId: auth.organizationId, userId: auth.userId },
      query,
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
}
