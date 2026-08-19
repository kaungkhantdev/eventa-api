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
import { ApiData, ApiPage } from '../../common/http/api-data.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import type { AuthContext } from '../auth/auth.types';
import { CurrentAuth } from '../../common/decorators/current-auth.decorator';
import {
  Permission,
  RequireAnyPermission,
  RequirePermissions,
} from '../../common/decorators/require-permissions.decorator';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import type { EventActor } from '../events/events.types';
import { Paginated } from '../../common/http/paginated';
import { CreateSpeakerDto } from './dto/create-speaker.dto';
import { ListSpeakersDto } from './dto/list-speakers.dto';
import { SpeakerResponseDto } from './dto/speaker-response.dto';
import { UpdateSpeakerDto } from './dto/update-speaker.dto';
import { SpeakersService } from './speakers.service';

@ApiTags('speakers')
@ApiBearerAuth()
@ApiForbiddenResponse({
  description: 'Missing the evSpeakers permission',
  type: ApiErrorDto,
})
@UseGuards(PermissionsGuard)
@Controller('events/:eventId/speakers')
export class SpeakersController {
  constructor(private readonly speakers: SpeakersService) {}

  @Post()
  @RequirePermissions(Permission.evSpeakers)
  @HttpCode(HttpStatus.CREATED)
  @ResponseMessage('Speaker added.')
  @ApiData(SpeakerResponseDto, HttpStatus.CREATED)
  create(
    @CurrentAuth() auth: AuthContext,
    @Param('eventId') eventId: string,
    @Body() dto: CreateSpeakerDto,
  ): Promise<SpeakerResponseDto> {
    return this.speakers.createSpeaker(actorOf(auth), eventId, dto);
  }

  /**
   * The directory (US-PROG-08). `evProgramView`, not `evSpeakers` — Staff
   * browse read-only to support attendees on-site; the write routes below keep
   * the manage permission, so read can be granted without granting edit.
   */
  @Get()
  @RequireAnyPermission(Permission.evProgramView, Permission.evSpeakers)
  @ResponseMessage('Speakers retrieved.')
  @ApiPage(SpeakerResponseDto)
  list(
    @CurrentAuth() auth: AuthContext,
    @Param('eventId') eventId: string,
    @Query() query: ListSpeakersDto,
  ): Promise<Paginated<SpeakerResponseDto>> {
    return this.speakers.listSpeakers(actorOf(auth), eventId, { ...query });
  }

  @Patch(':id')
  @RequirePermissions(Permission.evSpeakers)
  @ResponseMessage('Speaker updated.')
  @ApiData(SpeakerResponseDto)
  update(
    @CurrentAuth() auth: AuthContext,
    @Param('eventId') eventId: string,
    @Param('id') id: string,
    @Body() dto: UpdateSpeakerDto,
  ): Promise<SpeakerResponseDto> {
    return this.speakers.updateSpeaker(actorOf(auth), eventId, id, dto);
  }

  @Delete(':id')
  @RequirePermissions(Permission.evSpeakers)
  @ResponseMessage('Speaker removed.')
  remove(
    @CurrentAuth() auth: AuthContext,
    @Param('eventId') eventId: string,
    @Param('id') id: string,
    @Query('confirm') confirm?: string,
  ): Promise<void> {
    return this.speakers.deleteSpeaker(
      actorOf(auth),
      eventId,
      id,
      confirm === 'true',
    );
  }
}

/** The authenticated principal slice the program services need. */
function actorOf(auth: AuthContext): EventActor {
  return { organizationId: auth.organizationId, userId: auth.userId };
}
