import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentAuth } from '../../common/decorators/current-auth.decorator';
import {
  Permission,
  RequirePermissions,
} from '../../common/decorators/require-permissions.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { AdminGuard } from '../../common/guards/admin.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { ApiData } from '../../common/http/api-data.decorator';
import type { AuthContext } from '../auth/auth.types';
import { InviteResultDto, SendInviteDto } from './dto/invite.dto';
import { InvitationsService } from './invitations.service';

/**
 * Invitations (US-REG-06). `regManage`, not `regView` — the story's note is
 * explicit that Staff cannot invite.
 */
@ApiTags('invitations')
@ApiBearerAuth()
@Controller('invitations')
@UseGuards(AdminGuard, PermissionsGuard)
export class InvitationsController {
  constructor(private readonly invitations: InvitationsService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.regManage)
  @ResponseMessage('Invitation sent.')
  @ApiData(InviteResultDto)
  async invite(
    @CurrentAuth() auth: AuthContext,
    @Body() dto: SendInviteDto,
  ): Promise<InviteResultDto> {
    const result = await this.invitations.invite(auth, { ...dto });
    return {
      sent: result.sent,
      recipientEmail: result.recipientEmail,
      sentAt: result.sentAt.toISOString(),
    };
  }
}
