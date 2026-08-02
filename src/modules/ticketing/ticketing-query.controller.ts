import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiForbiddenResponse, ApiTags } from '@nestjs/swagger';
import { CurrentAuth } from '../../common/decorators/current-auth.decorator';
import {
  Permission,
  RequirePermissions,
} from '../../common/decorators/require-permissions.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { ApiErrorDto } from '../../common/errors/error-envelope';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { ApiPage } from '../../common/http/api-data.decorator';
import type { Paginated } from '../../common/http/paginated';
import type { AuthContext } from '../auth/auth.types';
import { ListTicketsDto } from './dto/list-tickets.dto';
import { TicketInventoryDto } from './dto/ticket-inventory.dto';
import { TicketingQueryService } from './ticketing-query.service';
import type { TicketStatusCounts } from './ticketing.types';

/**
 * The cross-event ticket inventory (US-TKT-04). Separate from the per-event
 * controller because it is rooted at `/tickets`, not `/events/:id/tickets` — same
 * bounded context, different resource path.
 */
@ApiTags('tickets')
@ApiBearerAuth()
@ApiForbiddenResponse({ description: 'Requires evCreate', type: ApiErrorDto })
@UseGuards(PermissionsGuard)
@Controller('tickets')
export class TicketingQueryController {
  constructor(private readonly tickets: TicketingQueryService) {}

  @Get()
  @RequirePermissions(Permission.evCreate)
  @ResponseMessage('Ticket inventory retrieved.')
  @ApiPage(TicketInventoryDto)
  list(
    @CurrentAuth() auth: AuthContext,
    @Query() query: ListTicketsDto,
  ): Promise<Paginated<TicketInventoryDto>> {
    return this.tickets.list(actorOf(auth), query);
  }

  @Get('counts')
  @RequirePermissions(Permission.evCreate)
  @ResponseMessage('Ticket counts retrieved.')
  counts(@CurrentAuth() auth: AuthContext): Promise<TicketStatusCounts> {
    return this.tickets.statusCounts(actorOf(auth));
  }
}

const actorOf = (auth: AuthContext) => ({
  organizationId: auth.organizationId,
  userId: auth.userId,
});
