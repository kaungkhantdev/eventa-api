import { Body, Controller, Get, Param, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiForbiddenResponse, ApiTags } from '@nestjs/swagger';
import { ApiErrorDto } from '../../../common/errors/error-envelope';
import { ApiData } from '../../../common/http/api-data.decorator';
import { ResponseMessage } from '../../../common/decorators/response-message.decorator';
import type { AuthContext } from '../../identity/auth.types';
import { CurrentAuth } from '../../identity/decorators/current-auth.decorator';
import {
  Permission,
  RequirePermissions,
} from '../../identity/decorators/require-permissions.decorator';
import { PermissionsGuard } from '../../identity/guards/permissions.guard';
import type { EventActor } from '../events.types';
import { ConfigureGeneralDto } from './dto/configure-general.dto';
import { ConfigureReservedDto } from './dto/configure-reserved.dto';
import { SeatingResponseDto } from './dto/seating-response.dto';
import { SeatingService } from './seating.service';

@ApiTags('seating')
@ApiBearerAuth()
@ApiForbiddenResponse({
  description: 'Missing the evCreate permission',
  type: ApiErrorDto,
})
@UseGuards(PermissionsGuard)
@Controller('events/:eventId/seating')
export class SeatingController {
  constructor(private readonly seating: SeatingService) {}

  @Get()
  @RequirePermissions(Permission.evCreate)
  @ResponseMessage('Seating retrieved.')
  @ApiData(SeatingResponseDto)
  get(
    @CurrentAuth() auth: AuthContext,
    @Param('eventId') eventId: string,
  ): Promise<SeatingResponseDto> {
    return this.seating.getSeating(actorOf(auth), eventId);
  }

  @Put('reserved')
  @RequirePermissions(Permission.evCreate)
  @ResponseMessage('Reserved seating configured.')
  @ApiData(SeatingResponseDto)
  reserved(
    @CurrentAuth() auth: AuthContext,
    @Param('eventId') eventId: string,
    @Body() dto: ConfigureReservedDto,
  ): Promise<SeatingResponseDto> {
    return this.seating.configureReserved(actorOf(auth), eventId, dto);
  }

  @Put('general')
  @RequirePermissions(Permission.evCreate)
  @ResponseMessage('General admission configured.')
  @ApiData(SeatingResponseDto)
  general(
    @CurrentAuth() auth: AuthContext,
    @Param('eventId') eventId: string,
    @Body() dto: ConfigureGeneralDto,
  ): Promise<SeatingResponseDto> {
    return this.seating.configureGeneral(actorOf(auth), eventId, dto);
  }
}

/** The authenticated principal slice the seating service needs. */
function actorOf(auth: AuthContext): EventActor {
  return { organizationId: auth.organizationId, userId: auth.userId };
}
