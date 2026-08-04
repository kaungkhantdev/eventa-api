import { Controller, Get, Header, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentAuth } from '../../common/decorators/current-auth.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { SkipResponseEnvelope } from '../../common/decorators/skip-envelope.decorator';
import { ApiData } from '../../common/http/api-data.decorator';
import type { AuthContext } from '../auth/auth.types';
import { AttendeeTicketsService } from './attendee-tickets.service';
import { MyEventsDto, TicketPassDto } from './dto/my-events.dto';

/**
 * The attendee's own tickets (US-DISC-07/09). Signed-in only, and every route
 * acts on the CALLER's identity — there is no path that takes someone else's.
 * A ticket the caller does not own simply does not resolve.
 */
@ApiTags('attendee-tickets')
@ApiBearerAuth()
@Controller('me/tickets')
export class AttendeeTicketsController {
  constructor(private readonly tickets: AttendeeTicketsService) {}

  @Get()
  @ResponseMessage('Your events retrieved.')
  @ApiData(MyEventsDto)
  myEvents(@CurrentAuth() auth: AuthContext): Promise<MyEventsDto> {
    return this.tickets.myEvents(auth.userId);
  }

  @Get(':ticketId')
  @ResponseMessage('Ticket retrieved.')
  @ApiData(TicketPassDto)
  ticket(
    @CurrentAuth() auth: AuthContext,
    @Param('ticketId', ParseUUIDPipe) ticketId: string,
  ): Promise<TicketPassDto> {
    return this.tickets.ticket(auth.userId, ticketId);
  }

  /** The printable pass — served as an image, not inside the envelope. */
  @Get(':ticketId/pass.svg')
  @SkipResponseEnvelope()
  @Header('Content-Type', 'image/svg+xml')
  @Header('Content-Disposition', 'attachment; filename="ticket-pass.svg"')
  pass(
    @CurrentAuth() auth: AuthContext,
    @Param('ticketId', ParseUUIDPipe) ticketId: string,
  ): Promise<string> {
    return this.tickets.passSvg(auth.userId, ticketId);
  }
}
