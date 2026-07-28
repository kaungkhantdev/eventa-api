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
import { ApiData } from '../../common/http/api-data.decorator';
import { Paginated } from '../../common/http/paginated';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import type { AuthContext } from '../identity/auth.types';
import { CurrentAuth } from '../identity/decorators/current-auth.decorator';
import { CreateEventDto } from './dto/create-event.dto';
import { EventResponseDto } from './dto/event-response.dto';
import { ListEventsQueryDto } from './dto/list-events.query.dto';
import { EventsService } from './events.service';
import { AdminGuard } from './guards/admin.guard';

@ApiTags('events')
@ApiBearerAuth()
@ApiForbiddenResponse({
  description: 'Admin persona required',
  type: ApiErrorDto,
})
@UseGuards(AdminGuard)
@Controller('events')
export class EventsController {
  constructor(private readonly events: EventsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ResponseMessage('Event created.')
  @ApiData(EventResponseDto)
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
  @ResponseMessage('Events retrieved.')
  @ApiData(EventResponseDto)
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
