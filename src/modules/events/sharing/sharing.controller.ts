import { Controller, Get, Param, UseGuards } from '@nestjs/common';
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
import { AdminGuard } from '../guards/admin.guard';
import { ShareResponseDto } from './dto/share-response.dto';
import { SharingService } from './sharing.service';

@ApiTags('events')
@ApiBearerAuth()
@ApiForbiddenResponse({
  description: 'Admin persona or evCreate permission missing',
  type: ApiErrorDto,
})
@UseGuards(AdminGuard, PermissionsGuard)
@Controller('events')
export class SharingController {
  constructor(private readonly sharing: SharingService) {}

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
