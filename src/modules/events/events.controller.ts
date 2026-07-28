import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
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
import { RequirePermissions } from '../identity/decorators/require-permissions.decorator';
import { PermissionsGuard } from '../identity/guards/permissions.guard';
import { CreateEventDto } from './dto/create-event.dto';
import { EventResponseDto } from './dto/event-response.dto';
import { ListEventsQueryDto } from './dto/list-events.query.dto';
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
  @RequirePermissions('evCreate')
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
  @RequirePermissions('evCreate')
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
}
