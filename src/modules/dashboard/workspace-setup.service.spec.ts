import { Permission } from '../../common/decorators/require-permissions.decorator';
import type { PermissionsService } from '../access/permissions.service';
import type { AuthContext } from '../auth/auth.types';
import type {
  EventInsightsPort,
  InventoryInsightsPort,
} from './ports/operations-insights.port';
import type {
  OrganizationSetupPort,
  PaymentSetupPort,
} from './ports/workspace-setup.port';
import { WorkspaceSetupService } from './workspace-setup.service';

const ORG = 7;

const auth: AuthContext = {
  userId: 'u-1',
  organizationId: ORG,
  sessionId: 's-1',
  persona: 'admin',
};

describe('WorkspaceSetupService (US-DASH-01, the first-run path)', () => {
  let organization: jest.Mocked<OrganizationSetupPort>;
  let payments: jest.Mocked<PaymentSetupPort>;
  let events: jest.Mocked<EventInsightsPort>;
  let inventory: jest.Mocked<InventoryInsightsPort>;
  let permissions: jest.Mocked<PermissionsService>;
  let service: WorkspaceSetupService;

  /** Everything done, so each test can knock out the one thing it is about. */
  beforeEach(() => {
    organization = { isConfigured: jest.fn().mockResolvedValue(true) };
    payments = { isConnected: jest.fn().mockResolvedValue(true) };
    events = {
      reach: jest.fn(),
      setupMilestones: jest
        .fn()
        .mockResolvedValue({ created: true, published: true }),
    };
    inventory = {
      countSellingOut: jest.fn(),
      sellingFast: jest.fn(),
      hasTicketType: jest.fn().mockResolvedValue(true),
    };
    permissions = {
      getFor: jest
        .fn()
        .mockResolvedValue([Permission.setSettings, Permission.evCreate]),
    } as unknown as jest.Mocked<PermissionsService>;
    service = new WorkspaceSetupService(
      organization,
      payments,
      events,
      inventory,
      permissions,
    );
  });

  describe('what the workspace has done', () => {
    it('reports every step of a workspace that is fully set up', async () => {
      const setup = await service.load(auth);

      expect(setup).toEqual({
        organizationConfigured: true,
        paymentsConnected: true,
        eventCreated: true,
        ticketTypeAdded: true,
        eventPublished: true,
      });
    });

    it('reports a brand-new workspace as having done none of it', async () => {
      organization.isConfigured.mockResolvedValue(false);
      payments.isConnected.mockResolvedValue(false);
      events.setupMilestones.mockResolvedValue({
        created: false,
        published: false,
      });
      inventory.hasTicketType.mockResolvedValue(false);

      const setup = await service.load(auth);

      expect(setup).toEqual({
        organizationConfigured: false,
        paymentsConnected: false,
        eventCreated: false,
        ticketTypeAdded: false,
        eventPublished: false,
      });
    });

    it('asks each owning module rather than deciding for itself', async () => {
      await service.load(auth);

      // Every fact is tenant-scoped by the caller's own organization; there is
      // no argument through which another workspace could be named.
      expect(organization.isConfigured).toHaveBeenCalledWith(ORG);
      expect(payments.isConnected).toHaveBeenCalledWith(ORG);
      expect(events.setupMilestones).toHaveBeenCalledWith(ORG);
      expect(inventory.hasTicketType).toHaveBeenCalledWith(ORG);
    });
  });

  /**
   * Withheld is not the same as not done, and the difference is load-bearing.
   * `false` for "payments are connected" tells a returning organizer to go and
   * connect Stripe a second time; `null` says only that this person may not be
   * told. The web treats null as unknown and claims nothing.
   */
  describe('when a step is none of the caller’s business', () => {
    it('withholds the settings steps from someone without setSettings', async () => {
      permissions.getFor.mockResolvedValue([Permission.evCreate]);

      const setup = await service.load(auth);

      expect(setup.organizationConfigured).toBeNull();
      expect(setup.paymentsConnected).toBeNull();
    });

    it('never even asks about settings it may not report', async () => {
      permissions.getFor.mockResolvedValue([Permission.evCreate]);

      await service.load(auth);

      expect(organization.isConfigured).not.toHaveBeenCalled();
      expect(payments.isConnected).not.toHaveBeenCalled();
    });

    it('still reports the event steps to that same person', async () => {
      permissions.getFor.mockResolvedValue([Permission.evCreate]);

      const setup = await service.load(auth);

      // A checklist is not all-or-nothing: the steps they can act on remain.
      expect(setup.eventCreated).toBe(true);
      expect(setup.ticketTypeAdded).toBe(true);
      expect(setup.eventPublished).toBe(true);
    });

    it('withholds the event steps from someone without evCreate', async () => {
      permissions.getFor.mockResolvedValue([Permission.setSettings]);

      const setup = await service.load(auth);

      expect(setup.eventCreated).toBeNull();
      expect(setup.ticketTypeAdded).toBeNull();
      expect(setup.eventPublished).toBeNull();
    });

    it('never even asks about events it may not report', async () => {
      permissions.getFor.mockResolvedValue([Permission.setSettings]);

      await service.load(auth);

      expect(events.setupMilestones).not.toHaveBeenCalled();
      expect(inventory.hasTicketType).not.toHaveBeenCalled();
    });

    it('withholds everything from someone granted neither', async () => {
      permissions.getFor.mockResolvedValue([]);

      const setup = await service.load(auth);

      expect(setup).toEqual({
        organizationConfigured: null,
        paymentsConnected: null,
        eventCreated: null,
        ticketTypeAdded: null,
        eventPublished: null,
      });
    });
  });

  it('reads the caller’s own grants, never a claim from the request', async () => {
    await service.load(auth);

    expect(permissions.getFor).toHaveBeenCalledWith(ORG, auth.userId);
  });
});
