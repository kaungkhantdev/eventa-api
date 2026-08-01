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
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiForbiddenResponse, ApiTags } from '@nestjs/swagger';
import { ApiErrorDto } from '../../common/errors/error-envelope';
import { ApiData, ApiList } from '../../common/http/api-data.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import type { AuthContext } from '../auth/auth.types';
import { CurrentAuth } from '../../common/decorators/current-auth.decorator';
import {
  Permission,
  RequirePermissions,
} from '../../common/decorators/require-permissions.decorator';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import type { EventActor } from '../events/events.types';
import { CreateSpeakerDto } from './dto/create-speaker.dto';
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

  @Get()
  @RequirePermissions(Permission.evSpeakers)
  @ResponseMessage('Speakers retrieved.')
  @ApiList(SpeakerResponseDto)
  list(
    @CurrentAuth() auth: AuthContext,
    @Param('eventId') eventId: string,
  ): Promise<SpeakerResponseDto[]> {
    return this.speakers.listSpeakers(actorOf(auth), eventId);
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
  ): Promise<void> {
    return this.speakers.deleteSpeaker(actorOf(auth), eventId, id);
  }
}

/** The authenticated principal slice the program services need. */
function actorOf(auth: AuthContext): EventActor {
  return { organizationId: auth.organizationId, userId: auth.userId };
}
