import { Body, Controller, Get, Param, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentAuth } from '../../common/decorators/current-auth.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { DomainException } from '../../common/errors/domain.exception';
import { ApiList } from '../../common/http/api-data.decorator';
import { notificationKindEnum } from '../../db/schema';
import type { AuthContext } from '../auth/auth.types';
import { SetPreferenceDto } from './dto/set-preference.dto';
import type { NotificationCategory } from './notification-preferences.repository';
import {
  NotificationPreferencesService,
  type PreferenceView,
} from './notification-preferences.service';

/** Settings → Notifications (US-SET-06). Always the caller's own preferences. */
@ApiTags('notification-preferences')
@ApiBearerAuth()
@Controller('me/notification-preferences')
export class NotificationPreferencesController {
  constructor(private readonly preferences: NotificationPreferencesService) {}

  @Get()
  @ResponseMessage('Notification preferences retrieved.')
  @ApiList(Object)
  list(@CurrentAuth() auth: AuthContext): Promise<PreferenceView[]> {
    return this.preferences.list(auth);
  }

  @Patch(':category')
  @ResponseMessage('Notification preference updated.')
  @ApiList(Object)
  set(
    @CurrentAuth() auth: AuthContext,
    @Param('category') category: string,
    @Body() dto: SetPreferenceDto,
  ): Promise<PreferenceView[]> {
    return this.preferences.set(auth, assertCategory(category), dto);
  }
}

/** Path params are strings; narrow to the schema enum or 404. */
function assertCategory(value: string): NotificationCategory {
  const known = notificationKindEnum.enumValues.find((c) => c === value);
  if (!known) throw DomainException.notFound(`Unknown topic "${value}".`);
  return known;
}
