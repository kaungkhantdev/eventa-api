import {
  Controller,
  Get,
  Header,
  NotFoundException,
  Param,
  Res,
} from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { Public } from '../../common/decorators/public.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { SkipResponseEnvelope } from '../../common/decorators/skip-envelope.decorator';
import type { Env } from '../../config/env.validation';
import { canAddToCalendar, toCalendar } from './calendar';
import { PublicPagesService } from './public-pages.service';
import type { PublicPage } from './public-pages.types';

/**
 * The anonymous public event page (US-PAGE-01…08). Every route is `@Public` — a
 * shared link must work with no account — and read-only: nothing here books,
 * holds a seat or reads attendee data.
 */
@ApiTags('public-pages')
@Controller('public/events')
export class PublicPagesController {
  private readonly host: string;

  constructor(
    private readonly pages: PublicPagesService,
    config: ConfigService<Env, true>,
  ) {
    this.host = new URL(
      config.getOrThrow('PUBLIC_WEB_URL', { infer: true }),
    ).host;
  }

  @Public()
  @Get(':slug')
  @ResponseMessage('Event page retrieved.')
  @ApiOkResponse({
    description:
      'The full public page payload. `seatMap` is ' +
      '`{ seatsPerRow, rows: [{ label, ticketTypeId, seatTicketTypes }] }` — every seat row in ' +
      "row-number order. `seatTicketTypes` is each seat's ticket type in seat-number order " +
      '(index 0 = seat 1; one of `tickets[].id`, or null for a seat with no type). ' +
      "`ticketTypeId` is the row's type when every seat of it shares one, and null when its " +
      'seats sell different types or none — so a row split between Free and Normal reads null. ' +
      'Set for an in-person, reserved event once any seat has a ticket type (a partly typed row ' +
      'counts), and null for general admission, online, or a map with no typed seat ' +
      '(US-PAGE-05). It carries no seat status, holds or sales.',
  })
  getPage(@Param('slug') slug: string): Promise<PublicPage> {
    return this.pages.getPage(slug);
  }

  @Public()
  @Get(':slug/calendar.ics')
  @SkipResponseEnvelope()
  @Header('Content-Type', 'text/calendar; charset=utf-8')
  async calendar(
    @Param('slug') slug: string,
    @Res() res: Response,
  ): Promise<void> {
    const page = await this.pages.getPage(slug);
    if (!canAddToCalendar(page)) {
      throw new NotFoundException('This event has no scheduled time.');
    }
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${page.event.slug}.ics"`,
    );
    res.send(toCalendar(page, this.host));
  }
}
