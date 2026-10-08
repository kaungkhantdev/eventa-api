import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { MessageTemplatesController } from './message-templates.controller';
import { MessageTemplatesRepository } from './message-templates.repository';
import { MessageTemplatesService } from './message-templates.service';

/**
 * Which automated messages a workspace sends (US-MSG-01). eventa-worker reads
 * `message_templates.active` before sending; this is where an organizer sets it.
 */
@Module({
  // PermissionsGuard's service — the settings permission is enforced here.
  imports: [AccessModule],
  controllers: [MessageTemplatesController],
  providers: [MessageTemplatesService, MessageTemplatesRepository],
  exports: [MessageTemplatesService],
})
export class MessageTemplatesModule {}
