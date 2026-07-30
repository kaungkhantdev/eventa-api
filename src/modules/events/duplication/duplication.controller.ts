import {
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
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
import { EventResponseDto } from '../dto/event-response.dto';
import { DuplicationService } from './duplication.service';

@ApiTags('events')
@ApiBearerAuth()
@ApiForbiddenResponse({
  description: 'Missing the evCreate permission',
  type: ApiErrorDto,
})
@UseGuards(PermissionsGuard)
@Controller('events')
export class DuplicationController {
  constructor(private readonly duplication: DuplicationService) {}

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
