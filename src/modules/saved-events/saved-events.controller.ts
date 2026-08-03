import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiNoContentResponse, ApiTags } from '@nestjs/swagger';
import { CurrentAuth } from '../../common/decorators/current-auth.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { ApiData, ApiPage } from '../../common/http/api-data.decorator';
import type { Paginated } from '../../common/http/paginated';
import type { AuthContext } from '../auth/auth.types';
import { EventCardDto } from '../discover/dto/event-card.dto';
import { ListSavedEventsDto } from './dto/list-saved-events.dto';
import {
  MergeResultDto,
  MergeSavedEventsDto,
} from './dto/merge-saved-events.dto';
import { SavedEventsService } from './saved-events.service';

/**
 * The attendee's saved events (US-DISC-03). Signed-in only — a save has to
 * outlive the browser tab to be worth anything, and the account is what carries
 * it to the next device. Every route acts on the caller's own `userId`; there is
 * no route that takes someone else's.
 */
@ApiTags('saved-events')
@ApiBearerAuth()
@Controller('me/saved-events')
export class SavedEventsController {
  constructor(private readonly saved: SavedEventsService) {}

  @Get()
  @ResponseMessage('Saved events retrieved.')
  @ApiPage(EventCardDto)
  list(
    @CurrentAuth() auth: AuthContext,
    @Query() query: ListSavedEventsDto,
  ): Promise<Paginated<EventCardDto>> {
    return this.saved.list(auth.userId, query);
  }

  @Put(':eventId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse({ description: 'Saved (repeating this is harmless)' })
  save(
    @CurrentAuth() auth: AuthContext,
    @Param('eventId', ParseUUIDPipe) eventId: string,
  ): Promise<void> {
    return this.saved.save(auth.userId, eventId);
  }

  @Delete(':eventId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse({ description: 'No longer saved' })
  unsave(
    @CurrentAuth() auth: AuthContext,
    @Param('eventId', ParseUUIDPipe) eventId: string,
  ): Promise<void> {
    return this.saved.unsave(auth.userId, eventId);
  }

  /** Called by the client right after sign-in, with the guest session's hearts. */
  @Post('merge')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Saved events merged.')
  @ApiData(MergeResultDto)
  merge(
    @CurrentAuth() auth: AuthContext,
    @Body() body: MergeSavedEventsDto,
  ): Promise<MergeResultDto> {
    return this.saved.merge(auth.userId, body.eventIds);
  }
}
