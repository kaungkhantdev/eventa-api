import { Controller, Get, Param, UseGuards } from '@nestjs/common';
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
import { AdminGuard } from '../../common/guards/admin.guard';
import { ShareResponseDto } from './dto/share-response.dto';
import { EventSharingService } from './event-sharing.service';

@ApiTags('events')
@ApiBearerAuth()
@ApiForbiddenResponse({
  description: 'Admin persona or evCreate permission missing',
  type: ApiErrorDto,
})
@UseGuards(AdminGuard, PermissionsGuard)
@Controller('events')
export class EventSharingController {
  constructor(private readonly sharing: EventSharingService) {}

  @Get(':id/share')
  @RequirePermissions(Permission.evCreate)
  @ResponseMessage('Share links retrieved.')
  @ApiData(ShareResponseDto)
  share(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
  ): Promise<ShareResponseDto> {
    return this.sharing.share(
      { organizationId: auth.organizationId, userId: auth.userId },
      id,
    );
  }
}
