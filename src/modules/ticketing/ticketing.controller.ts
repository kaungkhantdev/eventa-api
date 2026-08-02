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
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { ApiErrorDto } from '../../common/errors/error-envelope';
import { ApiData, ApiList } from '../../common/http/api-data.decorator';
import type { AuthContext } from '../auth/auth.types';
import { CurrentAuth } from '../../common/decorators/current-auth.decorator';
import {
  Permission,
  RequirePermissions,
} from '../../common/decorators/require-permissions.decorator';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { TicketResponseDto } from './dto/ticket-response.dto';
import { UpdateTicketDto } from './dto/update-ticket.dto';
import { TicketingService } from './ticketing.service';
import type { CreateTicketInput, UpdateTicketInput } from './ticketing.types';

@ApiTags('tickets')
@ApiBearerAuth()
@ApiForbiddenResponse({ description: 'Requires evCreate', type: ApiErrorDto })
@UseGuards(PermissionsGuard)
@Controller('events/:eventId/tickets')
export class TicketingController {
  constructor(private readonly tickets: TicketingService) {}

  @Post()
  @RequirePermissions(Permission.evCreate)
  @HttpCode(HttpStatus.CREATED)
  @ResponseMessage('Ticket type created.')
  @ApiData(TicketResponseDto, HttpStatus.CREATED)
  create(
    @CurrentAuth() auth: AuthContext,
    @Param('eventId') eventId: string,
    @Body() dto: CreateTicketDto,
  ): Promise<TicketResponseDto> {
    return this.tickets.createTicket(
      actorOf(auth),
      eventId,
      toCreateInput(dto),
    );
  }

  @Get()
  @RequirePermissions(Permission.evCreate)
  @ResponseMessage('Ticket types retrieved.')
  @ApiList(TicketResponseDto)
  list(
    @CurrentAuth() auth: AuthContext,
    @Param('eventId') eventId: string,
  ): Promise<TicketResponseDto[]> {
    return this.tickets.listTickets(actorOf(auth), eventId);
  }

  @Patch(':ticketId')
  @RequirePermissions(Permission.evCreate)
  @ResponseMessage('Ticket type updated.')
  @ApiData(TicketResponseDto)
  update(
    @CurrentAuth() auth: AuthContext,
    @Param('eventId') eventId: string,
    @Param('ticketId') ticketId: string,
    @Body() dto: UpdateTicketDto,
  ): Promise<TicketResponseDto> {
    return this.tickets.updateTicket(
      actorOf(auth),
      eventId,
      ticketId,
      toUpdateInput(dto),
    );
  }

  @Post(':ticketId/pause')
  @RequirePermissions(Permission.evCreate)
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Ticket sales paused.')
  @ApiData(TicketResponseDto)
  pause(
    @CurrentAuth() auth: AuthContext,
    @Param('eventId') eventId: string,
    @Param('ticketId') ticketId: string,
  ): Promise<TicketResponseDto> {
    return this.tickets.pauseTicket(actorOf(auth), eventId, ticketId);
  }

  @Post(':ticketId/resume')
  @RequirePermissions(Permission.evCreate)
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Ticket sales resumed.')
  @ApiData(TicketResponseDto)
  resume(
    @CurrentAuth() auth: AuthContext,
    @Param('eventId') eventId: string,
    @Param('ticketId') ticketId: string,
  ): Promise<TicketResponseDto> {
    return this.tickets.resumeTicket(actorOf(auth), eventId, ticketId);
  }

  @Delete(':ticketId')
  @RequirePermissions(Permission.evCreate)
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Ticket type removed.')
  remove(
    @CurrentAuth() auth: AuthContext,
    @Param('eventId') eventId: string,
    @Param('ticketId') ticketId: string,
  ): Promise<void> {
    return this.tickets.deleteTicket(actorOf(auth), eventId, ticketId);
  }
}

const actorOf = (auth: AuthContext) => ({
  organizationId: auth.organizationId,
  userId: auth.userId,
});

function toCreateInput(dto: CreateTicketDto): CreateTicketInput {
  const { salesStartAt, salesEndAt, ...rest } = dto;
  return {
    ...rest,
    ...(salesStartAt ? { salesStartAt: new Date(salesStartAt) } : {}),
    ...(salesEndAt ? { salesEndAt: new Date(salesEndAt) } : {}),
  };
}

function toUpdateInput(dto: UpdateTicketDto): UpdateTicketInput {
  const { salesStartAt, salesEndAt, ...rest } = dto;
  return {
    ...rest,
    ...(salesStartAt !== undefined
      ? { salesStartAt: new Date(salesStartAt) }
      : {}),
    ...(salesEndAt !== undefined ? { salesEndAt: new Date(salesEndAt) } : {}),
  };
}
