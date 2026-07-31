import {
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiForbiddenResponse, ApiTags } from '@nestjs/swagger';
import { ApiErrorDto } from '../../common/errors/error-envelope';
import { ApiData } from '../../common/http/api-data.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import type { AuthContext } from '../auth/auth.types';
import { CurrentAuth } from '../../common/decorators/current-auth.decorator';
import {
  Permission,
  RequirePermissions,
} from '../../common/decorators/require-permissions.decorator';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { EventResponseDto } from '../events/dto/event-response.dto';
import { EventDuplicationService } from './event-duplication.service';

@ApiTags('events')
@ApiBearerAuth()
@ApiForbiddenResponse({
  description: 'Missing the evCreate permission',
  type: ApiErrorDto,
})
@UseGuards(PermissionsGuard)
@Controller('events')
export class EventDuplicationController {
  constructor(private readonly duplication: EventDuplicationService) {}

  @Post(':id/duplicate')
  @RequirePermissions(Permission.evCreate)
  @HttpCode(HttpStatus.CREATED)
  @ResponseMessage('Event duplicated.')
  @ApiData(EventResponseDto, HttpStatus.CREATED)
  duplicate(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
  ): Promise<EventResponseDto> {
    return this.duplication.duplicate(
      { organizationId: auth.organizationId, userId: auth.userId },
      id,
    );
  }
}
