import { Controller, Get, Header, Param, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiForbiddenResponse, ApiTags } from '@nestjs/swagger';
import { CurrentAuth } from '../../common/decorators/current-auth.decorator';
import {
  Permission,
  RequirePermissions,
} from '../../common/decorators/require-permissions.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { SkipResponseEnvelope } from '../../common/decorators/skip-envelope.decorator';
import { ApiErrorDto } from '../../common/errors/error-envelope';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { ApiData } from '../../common/http/api-data.decorator';
import type { AuthContext } from '../auth/auth.types';
import { TicketShareDto } from './dto/ticket-share.dto';
import { TicketSharingService } from './ticket-sharing.service';

@ApiTags('tickets')
@ApiBearerAuth()
@ApiForbiddenResponse({ description: 'Requires evCreate', type: ApiErrorDto })
@UseGuards(PermissionsGuard)
@Controller('events/:eventId/tickets/:ticketId/share')
export class TicketSharingController {
  constructor(private readonly sharing: TicketSharingService) {}

  @Get()
  @RequirePermissions(Permission.evCreate)
  @ResponseMessage('Ticket share details retrieved.')
  @ApiData(TicketShareDto)
  share(
    @CurrentAuth() auth: AuthContext,
    @Param('eventId') eventId: string,
    @Param('ticketId') ticketId: string,
  ): Promise<TicketShareDto> {
    return this.sharing.share(actorOf(auth), eventId, ticketId);
  }

  /** The printable QR on its own — served as an image, not inside the envelope. */
  @Get('qr.svg')
  @RequirePermissions(Permission.evCreate)
  @SkipResponseEnvelope()
  @Header('Content-Type', 'image/svg+xml')
  @Header('Content-Disposition', 'attachment; filename="ticket-qr.svg"')
  qr(
    @CurrentAuth() auth: AuthContext,
    @Param('eventId') eventId: string,
    @Param('ticketId') ticketId: string,
  ): Promise<string> {
    return this.sharing.qrImage(actorOf(auth), eventId, ticketId);
  }
}

const actorOf = (auth: AuthContext) => ({
  organizationId: auth.organizationId,
  userId: auth.userId,
});
