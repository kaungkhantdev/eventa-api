import { Body, Controller, Get, Param, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentAuth } from '../../common/decorators/current-auth.decorator';
import {
  Permission,
  RequirePermissions,
} from '../../common/decorators/require-permissions.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import type { AuthContext } from '../auth/auth.types';
import { SetFaqsDto, SetHighlightsDto } from './dto/page-content.dto';
import {
  EventPageContentService,
  type FaqView,
  type HighlightView,
} from './event-page-content.service';

/** Highlights and FAQs for an event's public page (US-PAGE-04/06). */
@ApiTags('event-page-content')
@ApiBearerAuth()
@UseGuards(PermissionsGuard)
@Controller('events/:id')
export class EventPageContentController {
  constructor(private readonly content: EventPageContentService) {}

  @Get('highlights')
  @RequirePermissions(Permission.evCreate)
  @ResponseMessage('Highlights retrieved.')
  listHighlights(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
  ): Promise<HighlightView[]> {
    return this.content.listHighlights(auth, id);
  }

  @Put('highlights')
  @RequirePermissions(Permission.evCreate)
  @ResponseMessage('Highlights updated.')
  setHighlights(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Body() dto: SetHighlightsDto,
  ): Promise<HighlightView[]> {
    return this.content.setHighlights(auth, id, dto.highlights);
  }

  @Get('faqs')
  @RequirePermissions(Permission.evCreate)
  @ResponseMessage('FAQs retrieved.')
  listFaqs(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
  ): Promise<FaqView[]> {
    return this.content.listFaqs(auth, id);
  }

  @Put('faqs')
  @RequirePermissions(Permission.evCreate)
  @ResponseMessage('FAQs updated.')
  setFaqs(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Body() dto: SetFaqsDto,
  ): Promise<FaqView[]> {
    return this.content.setFaqs(auth, id, dto.faqs);
  }
}
