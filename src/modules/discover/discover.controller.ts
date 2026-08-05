import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { ApiPage } from '../../common/http/api-data.decorator';
import type { Paginated } from '../../common/http/paginated';
import { DiscoverService } from './discover.service';
import { BrowseEventsDto } from './dto/browse-events.dto';
import { EventCardDto } from './dto/event-card.dto';

/**
 * The anonymous Discover surface (US-DISC-01/02). Every route is `@Public` — a
 * visitor browses before they have any reason to sign up — and read-only: nothing
 * here books, holds a seat, or reads attendee data.
 */
@ApiTags('discover')
@Controller('public/discover')
export class DiscoverController {
  constructor(private readonly discover: DiscoverService) {}

  @Public()
  @Get()
  @ResponseMessage('Events retrieved.')
  @ApiPage(EventCardDto)
  browse(@Query() query: BrowseEventsDto): Promise<Paginated<EventCardDto>> {
    return this.discover.browse(query);
  }

  @Public()
  @Get('categories')
  @ResponseMessage('Categories retrieved.')
  @ApiOkResponse({ type: [String], description: 'Filter chips for the grid' })
  categories(): Promise<string[]> {
    return this.discover.categories();
  }
}
