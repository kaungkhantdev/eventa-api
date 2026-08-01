import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { AuditController } from './audit.controller';
import { AuditRepository } from './audit.repository';
import { AuditService } from './audit.service';

/**
 * The security & access audit log (US-SET-05) — append-only and time-ordered.
 * Depends on AccessModule for PermissionsService, which decides whether the
 * caller sees the whole workspace or only their own events.
 */
@Module({
  imports: [AccessModule],
  controllers: [AuditController],
  providers: [AuditService, AuditRepository],
  exports: [AuditService],
})
export class AuditModule {}
