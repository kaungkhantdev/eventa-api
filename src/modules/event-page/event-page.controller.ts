import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiForbiddenResponse, ApiTags } from '@nestjs/swagger';
import { CurrentAuth } from '../../common/decorators/current-auth.decorator';
import {
  Permission,
  RequirePermissions,
} from '../../common/decorators/require-permissions.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { ApiErrorDto } from '../../common/errors/error-envelope';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import type { AuthContext } from '../auth/auth.types';
import { PreviewPageDto } from './dto/preview-page.dto';
import { UpdatePageDto } from './dto/update-page.dto';
import { EventPageService } from './event-page.service';
import type { PageSettings, PreviewPage } from './event-page.types';

/**
 * The organizer's page controls (US-PAGE-09/10). Changing the design or address
 * needs `evPublish`; previewing needs only `evCreate`, so Staff can look without
 * being able to change anything. Never public — the rendered page is.
 */
@ApiTags('event-page')
@ApiBearerAuth()
@ApiForbiddenResponse({
  description: 'Insufficient permission',
  type: ApiErrorDto,
})
@UseGuards(PermissionsGuard)
@Controller('events')
export class EventPageController {
  constructor(private readonly page: EventPageService) {}

  @Patch(':id/page')
  @RequirePermissions(Permission.evPublish)
  @ResponseMessage('Page settings updated.')
  updatePage(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Body() dto: UpdatePageDto,
  ): Promise<PageSettings> {
    return this.page.updatePage(auth, id, dto);
  }

  @Post('page/preview')
  @RequirePermissions(Permission.evCreate)
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Preview rendered — nothing was saved.')
  preview(
    @CurrentAuth() auth: AuthContext,
    @Body() dto: PreviewPageDto,
  ): Promise<PreviewPage> {
    return this.page.preview(auth, dto);
  }
}
