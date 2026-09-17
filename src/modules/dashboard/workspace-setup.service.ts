import { Injectable } from '@nestjs/common';
import { Permission } from '../../common/decorators/require-permissions.decorator';
import { PermissionsService } from '../access/permissions.service';
import type { AuthContext } from '../auth/auth.types';
import {
  EventInsightsPort,
  InventoryInsightsPort,
} from './ports/operations-insights.port';
import {
  OrganizationSetupPort,
  PaymentSetupPort,
} from './ports/workspace-setup.port';

/**
 * How far a workspace has been set up (US-DASH-01) — the five steps Home walks
 * a new organizer through, on the way to a first paid registration.
 *
 * The steps are in dependency order, and each is a fact held by the module that
 * owns it: an event cannot be sold before the organization has invoice details
 * and somewhere for the money to land, and nothing can be discovered before it
 * is published. Nothing here is inferred from another step.
 *
 * `null` is not `false`. A step the caller may not be told about is withheld,
 * because "you may not see this" and "this has not been done" are different
 * facts and only one of them means *go and do it*. Telling a returning
 * organizer to connect Stripe again, because a Staff account could not see the
 * payment settings, would be worse than saying nothing.
 *
 * A step that is withheld is also never fetched. That is the module's rule
 * rather than an optimization: the cheapest way to be sure a figure cannot
 * leak is not to read it.
 */

export interface WorkspaceSetup {
  /** Null when withheld — see the note above; never coerce to false. */
  organizationConfigured: boolean | null;
  paymentsConnected: boolean | null;
  eventCreated: boolean | null;
  ticketTypeAdded: boolean | null;
  eventPublished: boolean | null;
}

/** Every step withheld — the answer for a caller granted nothing. */
const NOTHING_TO_SAY: WorkspaceSetup = {
  organizationConfigured: null,
  paymentsConnected: null,
  eventCreated: null,
  ticketTypeAdded: null,
  eventPublished: null,
};

@Injectable()
export class WorkspaceSetupService {
  constructor(
    private readonly organization: OrganizationSetupPort,
    private readonly payments: PaymentSetupPort,
    private readonly events: EventInsightsPort,
    private readonly inventory: InventoryInsightsPort,
    private readonly permissions: PermissionsService,
  ) {}

  async load(auth: AuthContext): Promise<WorkspaceSetup> {
    const granted = await this.permissions.getFor(
      auth.organizationId,
      auth.userId,
    );
    // The same keys that gate the pages each step links to, so the checklist
    // can never offer a step the caller would be refused on arrival.
    const settings = granted.includes(Permission.setSettings);
    const eventing = granted.includes(Permission.evCreate);

    const [organization, payments, milestones, ticketType] = await Promise.all([
      settings ? this.organization.isConfigured(auth.organizationId) : null,
      settings ? this.payments.isConnected(auth.organizationId) : null,
      eventing ? this.events.setupMilestones(auth.organizationId) : null,
      eventing ? this.inventory.hasTicketType(auth.organizationId) : null,
    ]);

    return {
      ...NOTHING_TO_SAY,
      organizationConfigured: organization,
      paymentsConnected: payments,
      eventCreated: milestones && milestones.created,
      ticketTypeAdded: ticketType,
      eventPublished: milestones && milestones.published,
    };
  }
}
