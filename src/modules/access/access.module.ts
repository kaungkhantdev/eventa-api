import { Module, forwardRef } from '@nestjs/common';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { AuthModule } from '../auth/auth.module';
import { AccessRepository } from './access.repository';
import { AccessService } from './access.service';
import { MembersController } from './members.controller';
import { PermissionsService } from './permissions.service';
import { RolesController } from './roles.controller';
import { RolesService } from './roles.service';
import { SystemRolesService } from './system-roles.service';

/**
 * Workspace access control: team members, roles and the permission catalog (RBAC).
 * Exports PermissionsService + PermissionsGuard so any module can enforce
 * `@RequirePermissions(...)` server-side. Inviting a teammate signs an invite token
 * (AuthModule), which in turn resolves permissions here — wired with `forwardRef`.
 */
@Module({
  imports: [forwardRef(() => AuthModule)],
  controllers: [RolesController, MembersController],
  providers: [
    AccessService,
    AccessRepository,
    RolesService,
    PermissionsService,
    PermissionsGuard,
    SystemRolesService,
  ],
  exports: [
    PermissionsService,
    PermissionsGuard,
    AccessRepository,
    SystemRolesService,
  ],
})
export class AccessModule {}
