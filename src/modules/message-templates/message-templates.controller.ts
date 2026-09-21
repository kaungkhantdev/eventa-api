import { Body, Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiForbiddenResponse, ApiTags } from '@nestjs/swagger';
import { CurrentAuth } from '../../common/decorators/current-auth.decorator';
import {
  Permission,
  RequirePermissions,
} from '../../common/decorators/require-permissions.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { ApiErrorDto } from '../../common/errors/error-envelope';
import { AdminGuard } from '../../common/guards/admin.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { ApiList } from '../../common/http/api-data.decorator';
import type { AuthContext } from '../auth/auth.types';
import { MessageTemplateDto } from './dto/message-template.dto';
import { SetTemplateActiveDto } from './dto/set-template-active.dto';
import { SetWordingDto } from './dto/set-wording.dto';
import {
  MessageTemplatesService,
  type MessageTemplateView,
} from './message-templates.service';

/**
 * The automated messages a workspace sends (US-MSG-01).
 *
 * Both endpoints answer with the WHOLE list. A switch changes one message, but
 * the page shows all of them, and returning the list is what stops a card and
 * its neighbours drifting apart after a failed write.
 */
@ApiTags('message-templates')
@ApiBearerAuth()
@UseGuards(AdminGuard, PermissionsGuard)
@RequirePermissions(Permission.setSettings)
@ApiForbiddenResponse({
  type: ApiErrorDto,
  description: 'Changing what attendees are sent is a settings permission.',
})
@Controller('message-templates')
export class MessageTemplatesController {
  constructor(private readonly templates: MessageTemplatesService) {}

  @Get()
  @ResponseMessage('Automated messages retrieved.')
  @ApiList(MessageTemplateDto)
  list(@CurrentAuth() auth: AuthContext): Promise<MessageTemplateView[]> {
    return this.templates.list(auth);
  }

  /**
   * The organizer's own wording (US-MSG-02). A language left empty falls back
   * to Eventa's built-in copy rather than sending a blank.
   */
  @Patch(':slug/wording')
  @ResponseMessage('Wording saved.')
  @ApiList(MessageTemplateDto)
  setWording(
    @CurrentAuth() auth: AuthContext,
    @Param('slug') slug: string,
    @Body() dto: SetWordingDto,
  ): Promise<MessageTemplateView[]> {
    return this.templates.setWording(auth, slug, dto);
  }

  @Patch(':slug')
  @ResponseMessage('Automated message updated.')
  @ApiList(MessageTemplateDto)
  setActive(
    @CurrentAuth() auth: AuthContext,
    @Param('slug') slug: string,
    @Body() dto: SetTemplateActiveDto,
  ): Promise<MessageTemplateView[]> {
    return this.templates.setActive(auth, slug, dto.active);
  }
}
