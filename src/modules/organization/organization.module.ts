import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { UploadsModule } from '../uploads/uploads.module';
import { OrganizationController } from './organization.controller';
import { OrganizationRepository } from './organization.repository';
import { OrganizationSetupPort } from '../dashboard/ports/workspace-setup.port';
import { OrganizationSetupAdapter } from './organization-setup.adapter';
import { OrganizationLogoService } from './organization-logo.service';
import { OrganizationService } from './organization.service';

/**
 * The workspace's legal identity, tax details and branding (US-SET-07) — the
 * seller shown on every invoice, receipt and public event page. Depends on
 * AccessModule for the RBAC PermissionsGuard only.
 */
@Module({
  imports: [AccessModule, UploadsModule],
  controllers: [OrganizationController],
  providers: [
    { provide: OrganizationSetupPort, useClass: OrganizationSetupAdapter },
    OrganizationService,
    OrganizationLogoService,
    OrganizationRepository,
  ],
  exports: [OrganizationService, OrganizationSetupPort],
})
export class OrganizationModule {}
