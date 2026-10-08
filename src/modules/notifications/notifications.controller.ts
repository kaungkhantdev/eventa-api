import {
  Controller,
  Get,
  HttpCode,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentAuth } from '../../common/decorators/current-auth.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { AdminGuard } from '../../common/guards/admin.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { ApiData } from '../../common/http/api-data.decorator';
import type { AuthContext } from '../auth/auth.types';
import {
  NotificationFeedDto,
  NotificationsReadDto,
} from './dto/notification-feed.dto';
import { NotificationFeedQueryDto } from './dto/notification-feed.query.dto';
import { NotificationFeedService } from './notification-feed.service';
import {
  toNotificationFeed,
  toNotificationsRead,
} from './notifications.mapper';

/**
 * The notification feed (US-MSG-03).
 *
 * Deliberately NOT gated on a permission. Every member of a workspace has a
 * feed; what differs is what is in it. The service asks what this reader is
 * entitled to and fetches only that, so a member with no permissions gets an
 * empty feed rather than a 403 — refusing the page would tell them there is
 * something there to be refused.
 */
@ApiTags('notifications')
@ApiBearerAuth()
@UseGuards(AdminGuard, PermissionsGuard)
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly feed: NotificationFeedService) {}

  @Get()
  @ResponseMessage('Notifications retrieved.')
  @ApiData(NotificationFeedDto)
  async list(
    @CurrentAuth() auth: AuthContext,
    @Query() query: NotificationFeedQueryDto,
  ): Promise<NotificationFeedDto> {
    return toNotificationFeed(await this.feed.load(auth, query));
  }

  /**
   * 200, not 201: nothing was created. The watermark is a property of a member
   * that moved, and the response is what it moved to.
   */
  @Post('read')
  @HttpCode(200)
  @ResponseMessage('Notifications marked as read.')
  @ApiData(NotificationsReadDto)
  async markAllRead(
    @CurrentAuth() auth: AuthContext,
  ): Promise<NotificationsReadDto> {
    return toNotificationsRead(await this.feed.markAllRead(auth));
  }
}
